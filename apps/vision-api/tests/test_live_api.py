import json
import math
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from PIL import Image

from app import manage
from app.db import repository
from app.db.migrations import include_name, migration_engine
from app.db.session import open_session
from app.db.tables import SCHEMA, Base
from app.main import app
from app.manage import dev_state

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
STATE_URL = "/api/sites/dev-site/parking-state"
INGEST_URL = "/api/internal/parking-states"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PARKMAP_WORKER_TOKEN", TOKEN)
    monkeypatch.setenv("PARKMAP_STATE_FRESHNESS_S", "15")
    return TestClient(app)


@pytest.fixture
def seeded(database):
    assert manage.main(["seed-dev"]) == 0


def state_json(at=None, **overrides):
    payload = json.loads(dev_state(at or datetime.now(UTC)).model_dump_json())
    return {**payload, **overrides}


def still_image_json(photo_time, processed_at):
    return state_json(processed_at, source="STILL_IMAGE_LOOP", observed_at=photo_time.isoformat())


def area_state(client):
    response = client.get(STATE_URL)
    assert response.status_code == 200
    return response.json()["areas"][0]


def test_live_state_is_unavailable_without_storage(no_database, client):
    response = client.get(STATE_URL)

    assert response.status_code == 503
    assert response.json()["detail"] == "Live state storage is not configured."


def test_ingest_is_disabled_without_worker_token(no_database, monkeypatch):
    monkeypatch.delenv("PARKMAP_WORKER_TOKEN", raising=False)

    response = TestClient(app).post(INGEST_URL, json=state_json(), headers=AUTH)

    assert response.status_code == 503


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}])
def test_ingest_rejects_missing_or_wrong_token_before_reading_the_body(no_database, client, headers):
    assert client.post(INGEST_URL, json={"not": "a state"}, headers=headers).status_code == 401


def test_site_ids_are_validated(database, client):
    assert client.get("/api/sites/Bad_Site/parking-state").status_code == 422


def test_published_state_is_served_as_live_with_its_source(seeded, client):
    assert area_state(client)["status"] == "NO_DATA"

    assert client.post(INGEST_URL, json=state_json(), headers=AUTH).status_code == 204
    area = area_state(client)

    assert area["status"] == "LIVE"
    assert area["source"] == "SYNTHETIC_FIXTURE"
    assert {region["kind"] for region in area["regions"]} == {"AVAILABLE", "ALMOST_AVAILABLE", "UNKNOWN"}
    assert len(area["motorcycles"]) == 2


def test_rotated_roi_moves_demo_motorcycles_headings_and_regions_together(seeded, client, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-editor")
    definition = client.get("/api/sites/dev-site/lot-model").json()
    original_roi = definition["parking_areas"][0]["polygon"]
    with open_session() as session:
        repository.activate_calibration(session, "dev-area-1", "placement-test", {
            "ground_plane_homography.json": {"roi_metric": {"points": original_roi[0]}},
        })
        session.commit()
    payload = state_json(source="STILL_IMAGE_LOOP", calibration_version="placement-test")
    assert client.post(INGEST_URL, headers=AUTH, json=payload).status_code == 204
    definition["parking_areas"][0]["polygon"] = [[{"x_m": 20 - p["y_m"], "y_m": 2 + p["x_m"]} for p in ring] for ring in original_roi]
    editor = "/api/operator/lot-model/sites/dev-site"
    headers = {"Authorization": "Bearer test-editor"}
    saved = client.put(editor + "/draft", headers=headers, json={"definition": definition, "expected_revision": 0, "base_version": 1})
    assert saved.status_code == 200, saved.text
    activated = client.post(editor + "/activate", headers=headers, json={"expected_revision": saved.json()["revision"], "base_version": 1})
    assert activated.status_code == 200, activated.text
    result = area_state(client)
    assert result["status"] == "DEMO"
    assert result["observed_at"] == payload["observed_at"]
    before, after = payload["motorcycles"][0], result["motorcycles"][0]
    assert after["center"]["x_m"] == pytest.approx(20 - before["center"]["y_m"])
    assert after["center"]["y_m"] == pytest.approx(2 + before["center"]["x_m"])
    assert math.cos(after["heading_rad"]) == pytest.approx(math.cos(before["heading_rad"] + math.pi / 2))
    assert after["length_m"] == before["length_m"]
    assert after["width_m"] == before["width_m"]
    for original, moved in zip(payload["regions"], result["regions"], strict=True):
        assert moved["kind"] == original["kind"]
        for ring, transformed in zip(original["polygon"], moved["polygon"], strict=True):
            for p, q in zip(ring, transformed, strict=True):
                assert q["x_m"] == pytest.approx(20 - p["y_m"])
                assert q["y_m"] == pytest.approx(2 + p["x_m"])
    assert area_state(client)["motorcycles"] == result["motorcycles"]  # No accumulating transform on later polls.


def test_latest_processed_state_wins(seeded, client):
    now = datetime.now(UTC)
    client.post(INGEST_URL, json=state_json(now), headers=AUTH)
    client.post(INGEST_URL, json=state_json(now - timedelta(seconds=60)), headers=AUTH)

    assert area_state(client)["status"] == "LIVE"


def test_still_image_loop_is_demo_with_the_photo_time(seeded, client):
    now = datetime.now(UTC)
    first_photo = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
    client.post(INGEST_URL, json=still_image_json(first_photo + timedelta(minutes=5), now - timedelta(seconds=10)), headers=AUTH)
    # The loop wrapped around to an earlier photo; the newest processing is what readers see.
    assert client.post(INGEST_URL, json=still_image_json(first_photo, now), headers=AUTH).status_code == 204
    area = area_state(client)

    assert area["status"] == "DEMO"
    assert area["source"] == "STILL_IMAGE_LOOP"
    assert datetime.fromisoformat(area["observed_at"]) == first_photo
    assert area["regions"]


def test_still_image_loop_with_stale_processing_is_stale_without_regions(seeded, client):
    now = datetime.now(UTC)
    client.post(INGEST_URL, json=still_image_json(now - timedelta(days=30), now - timedelta(seconds=60)), headers=AUTH)
    area = area_state(client)

    assert area["status"] == "STALE"
    assert area["regions"] == []


def test_old_state_is_stale_without_regions(seeded, client):
    client.post(INGEST_URL, json=state_json(datetime.now(UTC) - timedelta(seconds=60)), headers=AUTH)
    area = area_state(client)

    assert area["status"] == "STALE"
    assert area["regions"] == []
    assert area["motorcycles"] == []


def test_state_from_another_calibration_is_not_shown(seeded, client, tmp_path):
    client.post(INGEST_URL, json=state_json(), headers=AUTH)
    for name in ("ground_plane_homography.json", "ground_plane_calibration.json"):
        (tmp_path / name).write_text("{}")
    (tmp_path / "parking_calibration.json").write_text(json.dumps({"camera_id": "dev-camera-1"}))

    assert manage.main(["register-calibration", "--parking-area-id", "dev-area-1", "--config-dir", str(tmp_path)]) == 0
    area = area_state(client)

    assert area["status"] == "CALIBRATION_MISMATCH"
    assert area["regions"] == []


def test_calibration_for_another_camera_is_rejected(seeded, tmp_path):
    for name in ("ground_plane_homography.json", "ground_plane_calibration.json"):
        (tmp_path / name).write_text("{}")
    (tmp_path / "parking_calibration.json").write_text(json.dumps({"camera_id": "other-camera"}))

    assert manage.main(["register-calibration", "--parking-area-id", "dev-area-1", "--config-dir", str(tmp_path)]) == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"camera_id": "other-camera"},
        {"parking_area_id": "missing-area"},
        {"observed_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat()},
        {"processed_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat()},
        {"observed_at": "2026-10-01T08:00:00"},
        {"schema_version": 1},
        {"source": "LIVE_CAMERA"},
    ],
)
def test_ingest_rejects_states_that_do_not_match_the_area(seeded, client, overrides):
    assert client.post(INGEST_URL, json={**state_json(), **overrides}, headers=AUTH).status_code == 422


def test_lot_model_includes_unmonitored_ground(seeded, client):
    response = client.get("/api/sites/dev-site/lot-model")

    assert response.status_code == 200
    lot_model = response.json()
    assert lot_model["version"] == 1
    assert [area["parking_area_id"] for area in lot_model["parking_areas"]] == ["dev-area-1"]
    assert lot_model["unmonitored"]
    assert lot_model["landmarks"] == []


def test_sites_are_listed_and_unknown_sites_are_not_found(seeded, client):
    assert [site["site_id"] for site in client.get("/api/sites").json()] == ["dev-site"]
    assert client.get("/api/sites/other-site/parking-state").status_code == 404
    assert client.get("/api/sites/other-site/lot-model").status_code == 404


def test_reseeding_creates_a_new_lot_model_version(seeded, client):
    assert manage.main(["seed-dev"]) == 0

    assert client.get("/api/sites/dev-site/lot-model").json()["version"] == 2


def test_purge_removes_only_old_states(seeded, client):
    client.post(INGEST_URL, json=state_json(), headers=AUTH)

    assert manage.main(["purge-states", "--older-than-days", "1"]) == 0
    assert area_state(client)["status"] == "LIVE"


def test_removing_a_site_removes_everything_it_owns(seeded, client):
    now = datetime.now(UTC)
    put_frame(client, now)
    client.post(INGEST_URL, json=state_json(now), headers=AUTH)
    frame_url = area_state(client)["frame"]["url"]
    assert manage.main(["create-site", "--site-id", "real-site", "--name", "Real site", "--latitude", "13.8", "--longitude", "100.5"]) == 0

    assert manage.main(["remove-site", "--site-id", "dev-site", "--confirm", "dev-site"]) == 0

    assert [site["site_id"] for site in client.get("/api/sites").json()] == ["real-site"]
    assert client.get(STATE_URL).status_code == 404
    assert client.get("/api/sites/dev-site/lot-model").status_code == 404
    assert client.get(frame_url).status_code == 404
    # Nothing is left behind: seeding again starts the development site from its first lot model version.
    assert manage.main(["seed-dev"]) == 0
    assert client.get("/api/sites/dev-site/lot-model").json()["version"] == 1


@pytest.mark.parametrize(("site_id", "confirm"), [("other-site", "other-site"), ("dev-site", "dev-sit")])
def test_removing_an_unknown_or_unconfirmed_site_is_refused(seeded, client, site_id, confirm):
    assert manage.main(["remove-site", "--site-id", site_id, "--confirm", confirm]) == 1

    assert [site["site_id"] for site in client.get("/api/sites").json()] == ["dev-site"]


def jpeg(width=64, height=48, image_format="JPEG"):
    buffer = BytesIO()
    Image.new("RGB", (width, height), (90, 90, 90)).save(buffer, format=image_format)
    return buffer.getvalue()


def put_frame(client, processed_at, body=None, *, area_id=None, content_type="image/jpeg", headers=AUTH):
    area_id = area_id or state_json()["parking_area_id"]
    return client.put(
        f"/api/internal/parking-areas/{area_id}/frame",
        params={"processed_at": processed_at.isoformat()},
        content=jpeg() if body is None else body,
        headers={**headers, "Content-Type": content_type},
    )


def test_a_shown_state_links_the_photo_it_was_computed_from(seeded, client):
    now = datetime.now(UTC)
    assert put_frame(client, now).status_code == 204
    assert client.post(INGEST_URL, json=state_json(now), headers=AUTH).status_code == 204
    frame = area_state(client)["frame"]

    assert (frame["width"], frame["height"]) == (64, 48)
    response = client.get(frame["url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert "immutable" in response.headers["cache-control"]
    assert response.content == jpeg()


def frame_url(processed_at):
    version = (processed_at - datetime(1970, 1, 1, tzinfo=UTC)) // timedelta(microseconds=1)
    return f"/api/parking-areas/{state_json()['parking_area_id']}/frame?v={version}"


def test_a_photo_stays_available_while_a_state_from_it_can_still_be_shown_fresh(seeded, client):
    # A reader's state can be a poll behind the newest analysis; its own photo must still load.
    now = datetime.now(UTC)
    expired, recent = now - timedelta(seconds=20), now - timedelta(seconds=4)
    put_frame(client, expired, jpeg(32, 24))
    put_frame(client, recent, jpeg(48, 36))
    client.post(INGEST_URL, json=state_json(recent), headers=AUTH)
    recent_url = area_state(client)["frame"]["url"]

    assert put_frame(client, now, jpeg(80, 60)).status_code == 204
    assert put_frame(client, now - timedelta(seconds=30), jpeg(16, 12)).status_code == 204
    client.post(INGEST_URL, json=state_json(now), headers=AUTH)

    assert recent_url == frame_url(recent)
    assert client.get(recent_url).content == jpeg(48, 36)
    assert area_state(client)["frame"]["width"] == 80
    # More than the 15 s freshness limit before the newest photo, no state can show it fresh.
    assert client.get(frame_url(expired)).status_code == 404
    assert client.get(frame_url(now - timedelta(seconds=30))).status_code == 404


@pytest.mark.parametrize("version", [-(10**18), 10**18, 10**30])
def test_an_impossible_photo_version_is_not_found(seeded, client, version):
    assert client.get(f"/api/parking-areas/{state_json()['parking_area_id']}/frame", params={"v": version}).status_code == 404


def test_no_photo_is_linked_to_a_state_it_was_not_computed_from(seeded, client):
    now = datetime.now(UTC)
    put_frame(client, now - timedelta(seconds=1))
    client.post(INGEST_URL, json=state_json(now), headers=AUTH)

    assert area_state(client)["frame"] is None


def test_no_photo_is_linked_to_a_stale_state(seeded, client):
    stale = datetime.now(UTC) - timedelta(seconds=60)
    put_frame(client, stale)
    client.post(INGEST_URL, json=state_json(stale), headers=AUTH)
    area = area_state(client)

    assert area["status"] == "STALE"
    assert area["frame"] is None


@pytest.mark.parametrize(
    ("overrides", "status_code"),
    [
        ({"headers": {}}, 401),
        ({"content_type": "image/png", "body": jpeg(image_format="PNG")}, 415),
        ({"body": jpeg(image_format="PNG")}, 400),
        ({"body": b"not an image"}, 400),
        ({"body": jpeg(4097, 8)}, 413),
        ({"body": b"0" * (3 * 1024 * 1024 + 1)}, 413),
        ({"area_id": "unknown-area"}, 422),
        ({"processed_at": datetime.now(UTC) + timedelta(minutes=5)}, 422),
        ({"processed_at": datetime.now(UTC).replace(tzinfo=None)}, 422),
    ],
)
def test_frame_ingest_rejects_what_it_cannot_trust(seeded, client, overrides, status_code):
    processed_at = overrides.pop("processed_at", datetime.now(UTC))
    assert put_frame(client, processed_at, **overrides).status_code == status_code
    area_id = state_json()["parking_area_id"]
    assert client.get(f"/api/parking-areas/{area_id}/frame", params={"v": 0}).status_code == 404


def test_migrations_match_table_definitions(database):
    engine = migration_engine()
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"include_schemas": True, "include_name": include_name, "version_table_schema": SCHEMA})
        assert compare_metadata(context, Base.metadata) == []
    engine.dispose()
