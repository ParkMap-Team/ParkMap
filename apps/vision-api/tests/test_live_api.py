import json
from datetime import UTC, datetime, timedelta

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient

from app import manage
from app.db.migrations import include_name, migration_engine
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


def state_json(observed_at=None, **overrides):
    payload = json.loads(dev_state(observed_at or datetime.now(UTC)).model_dump_json())
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


def test_migrations_match_table_definitions(database):
    engine = migration_engine()
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"include_schemas": True, "include_name": include_name, "version_table_schema": SCHEMA})
        assert compare_metadata(context, Base.metadata) == []
    engine.dispose()
