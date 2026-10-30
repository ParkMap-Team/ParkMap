import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import manage
from app.main import app
from app.models import LotModelDefinition

EDITOR_URL = "/api/operator/lot-model"
TOKEN = "test-lot-model-editor-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "spu-cam-01-lot-model.json"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", TOKEN)
    return TestClient(app)


@pytest.fixture
def seeded(database):
    assert manage.main(["seed-dev"]) == 0


def edited_definition(client):
    active = client.get("/api/sites/dev-site/lot-model").json()
    definition = {key: active[key] for key in ("schema_version", "outline", "parking_areas", "landmarks")}
    definition["landmarks"] = [{
        "landmark_id": "walkway", "kind": "WALKWAY", "position": {"x_m": 1, "y_m": -3},
        "polygon": [[{"x_m": 0, "y_m": -8}, {"x_m": 2, "y_m": -8}, {"x_m": 2, "y_m": 2}, {"x_m": 0, "y_m": 2}]],
        "measurement_source": "ESTIMATED",
    }]
    return definition


def test_editor_template_preserves_the_requested_fixture(monkeypatch, no_database):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", TOKEN)

    response = TestClient(app).get(f"{EDITOR_URL}/template", headers=AUTH)

    assert response.status_code == 200
    expected = LotModelDefinition.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))
    assert response.json() == expected.model_dump(mode="json")
    assert any(landmark.kind == "TREE" for landmark in expected.landmarks)


def test_saved_draft_survives_reload_without_changing_the_liff_model(seeded, client):
    active_before = client.get("/api/sites/dev-site/lot-model").json()
    definition = edited_definition(client)

    response = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": definition, "expected_revision": 0, "base_version": 1,
    })

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["revision"] == 1
    assert saved["base_version"] == saved["active_version"] == 1
    assert saved["is_published"] is False
    assert saved["definition"]["landmarks"][0]["polygon"] == definition["landmarks"][0]["polygon"]
    assert client.get(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH).json() == saved
    assert client.get("/api/sites/dev-site/lot-model").json() == active_before


def test_activation_publishes_a_new_version_using_the_existing_liff_contract(seeded, client):
    saved = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": edited_definition(client), "expected_revision": 0, "base_version": 1,
    }).json()

    response = client.post(f"{EDITOR_URL}/sites/dev-site/activate", headers=AUTH, json={
        "expected_revision": saved["revision"], "base_version": saved["base_version"],
    })

    assert response.status_code == 200, response.text
    published = response.json()
    assert published["is_published"] is True
    assert published["active_version"] == published["base_version"] == 2
    active = client.get("/api/sites/dev-site/lot-model").json()
    assert active["version"] == 2
    assert active["landmarks"] == saved["definition"]["landmarks"]
    assert active["unmonitored"]
    assert client.get("/api/sites/dev-site/parking-state").json()["areas"][0]["status"] == "NO_DATA"


def test_first_publication_round_trips_the_entire_spu_fixture(database, client):
    assert manage.main(["create-site", "--site-id", "sripatum", "--name", "Synthetic SPU test", "--latitude", "0", "--longitude", "0"]) == 0
    assert manage.main(["create-parking-area", "--site-id", "sripatum", "--parking-area-id", "sripatum-near-lot", "--camera-id", "test-spu-camera", "--name", "Test area"]) == 0
    initial = client.get(f"{EDITOR_URL}/sites/sripatum/draft", headers=AUTH).json()
    assert initial["revision"] == initial["base_version"] == initial["active_version"] == 0
    saved = client.put(f"{EDITOR_URL}/sites/sripatum/draft", headers=AUTH, json={
        "definition": initial["definition"], "expected_revision": 0, "base_version": 0,
    })
    assert saved.status_code == 200, saved.text
    published = client.post(f"{EDITOR_URL}/sites/sripatum/activate", headers=AUTH, json={"expected_revision": 1, "base_version": 0})
    assert published.status_code == 200, published.text
    active = client.get("/api/sites/sripatum/lot-model").json()
    assert active["version"] == 1
    assert active["landmarks"] == initial["definition"]["landmarks"]
    assert active["outline"] == initial["definition"]["outline"]
    assert active["parking_areas"] == initial["definition"]["parking_areas"]


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_editor_requires_a_separate_operator_token(no_database, client, headers):
    assert client.get(f"{EDITOR_URL}/template", headers=headers).status_code == 401
    assert client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=headers, json={}).status_code == 401


def test_editor_is_disabled_without_configuration(no_database, monkeypatch):
    monkeypatch.delenv("PARKMAP_EDITOR_TOKEN", raising=False)
    assert TestClient(app).get(f"{EDITOR_URL}/template", headers=AUTH).status_code == 503


def test_initial_draft_starts_from_the_spu_fixture_even_when_a_site_has_an_active_model(seeded, client):
    state = client.get(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH).json()
    assert state["revision"] == 0
    assert state["base_version"] == state["active_version"] == 1
    assert state["definition"] == client.get(f"{EDITOR_URL}/template", headers=AUTH).json()


def test_an_old_tab_cannot_overwrite_a_newer_draft(seeded, client):
    request = {"definition": edited_definition(client), "expected_revision": 0, "base_version": 1}
    saved = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json=request).json()
    assert client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json=request).status_code == 409
    assert client.get(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH).json() == saved


def test_saving_unchanged_content_does_not_bump_the_draft_revision(seeded, client):
    payload = {"definition": edited_definition(client), "expected_revision": 0, "base_version": 1}
    saved = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json=payload).json()
    response = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={**payload, "expected_revision": saved["revision"]})
    assert response.status_code == 200
    assert response.json() == saved


def test_a_changed_active_model_blocks_stale_activation(seeded, client):
    saved = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": edited_definition(client), "expected_revision": 0, "base_version": 1,
    }).json()
    assert manage.main(["seed-dev"]) == 0
    response = client.post(f"{EDITOR_URL}/sites/dev-site/activate", headers=AUTH, json={
        "expected_revision": saved["revision"], "base_version": 1,
    })
    assert response.status_code == 409
    assert client.get("/api/sites/dev-site/lot-model").json()["version"] == 2


@pytest.mark.parametrize("invalid", ["foreign-area", "crossed-polygon", "duplicate-id", "negative-radius", "crossed-outline", "crossed-parking-polygon", "outside-outline"])
def test_invalid_geometry_or_foreign_areas_cannot_replace_a_draft(seeded, client, invalid):
    definition = edited_definition(client)
    if invalid == "foreign-area":
        definition["parking_areas"][0]["parking_area_id"] = "other-site-area"
    elif invalid == "crossed-polygon":
        definition["landmarks"][0]["polygon"][0] = [
            {"x_m": 0, "y_m": 0}, {"x_m": 2, "y_m": 2}, {"x_m": 0, "y_m": 2}, {"x_m": 2, "y_m": 0},
        ]
    elif invalid == "duplicate-id":
        definition["landmarks"].append(definition["landmarks"][0])
    elif invalid == "negative-radius":
        definition["landmarks"] = [{"landmark_id": "tree", "kind": "TREE", "position": {"x_m": 0, "y_m": 0}, "height_m": 4, "radius_m": -1}]
    elif invalid == "crossed-outline":
        ring = definition["outline"][0]
        ring[1], ring[2] = ring[2], ring[1]
    elif invalid == "outside-outline":
        definition["parking_areas"][0]["polygon"][0][0]["x_m"] -= 1
    else:
        ring = definition["parking_areas"][0]["polygon"][0]
        ring[1], ring[2] = ring[2], ring[1]
    active_before = client.get("/api/sites/dev-site/lot-model").json()
    response = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": definition, "expected_revision": 0, "base_version": 1,
    })
    assert response.status_code == 422
    assert client.get(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH).json()["revision"] == 0
    assert client.get("/api/sites/dev-site/lot-model").json() == active_before


def test_roi_can_be_saved_after_operator_sets_the_lot_outline_to_match(database, client):
    assert manage.main(["create-site", "--site-id", "sripatum", "--name", "Test", "--latitude", "0", "--longitude", "0"]) == 0
    assert manage.main(["create-parking-area", "--site-id", "sripatum", "--parking-area-id", "sripatum-near-lot", "--camera-id", "test-camera", "--name", "Test"]) == 0
    definition = client.get(f"{EDITOR_URL}/template", headers=AUTH).json()
    # The source outline equals the ROI. A 90-degree turn around the origin leaves it.
    rotated = [[{"x_m": -point["y_m"], "y_m": point["x_m"]} for point in ring]
               for ring in definition["parking_areas"][0]["polygon"]]
    definition["parking_areas"][0]["polygon"] = rotated
    payload = {"definition": definition, "expected_revision": 0, "base_version": 0}
    outside = client.put(f"{EDITOR_URL}/sites/sripatum/draft", headers=AUTH, json=payload)
    assert outside.status_code == 422
    assert "must lie inside the lot outline" in outside.json()["detail"]
    definition["outline"] = rotated
    saved = client.put(f"{EDITOR_URL}/sites/sripatum/draft", headers=AUTH, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["definition"]["outline"] == rotated
    assert saved.json()["definition"]["landmarks"] == definition["landmarks"]
    activated = client.post(f"{EDITOR_URL}/sites/sripatum/activate", headers=AUTH, json={"expected_revision": 1, "base_version": 0})
    assert activated.status_code == 200
    assert client.get("/api/sites/sripatum/lot-model").json()["outline"] == rotated


def test_roi_edit_is_a_draft_until_activation_and_invalidates_old_calibration(seeded, client, monkeypatch):
    monkeypatch.setenv("PARKMAP_WORKER_TOKEN", "test-worker")
    state = manage.dev_state(datetime.now(UTC)).model_dump(mode="json")
    assert client.post("/api/internal/parking-states", headers={"Authorization": "Bearer test-worker"}, json=state).status_code == 204
    definition = edited_definition(client)
    definition["parking_areas"][0]["polygon"][0][0]["x_m"] += 0.5
    before = client.get("/api/sites/dev-site/lot-model").json()
    saved = client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": definition, "expected_revision": 0, "base_version": 1,
    })
    assert saved.status_code == 200, saved.text
    assert client.get("/api/sites/dev-site/lot-model").json() == before
    assert client.get("/api/sites/dev-site/parking-state").json()["areas"][0]["status"] == "LIVE"
    activated = client.post(f"{EDITOR_URL}/sites/dev-site/activate", headers=AUTH, json={
        "expected_revision": saved.json()["revision"], "base_version": 1,
    })
    assert activated.status_code == 200, activated.text
    assert client.get("/api/sites/dev-site/lot-model").json()["parking_areas"] == definition["parking_areas"]
    area = client.get("/api/sites/dev-site/parking-state").json()["areas"][0]
    assert area["status"] == "NOT_CALIBRATED"
    assert area["regions"] == []
    # An old worker may keep submitting states; this cannot reactivate the old evidence.
    assert client.post("/api/internal/parking-states", headers={"Authorization": "Bearer test-worker"}, json=state).status_code == 204
    area = client.get("/api/sites/dev-site/parking-state").json()["areas"][0]
    assert area["status"] == "NOT_CALIBRATED"
    assert area["motorcycles"] == []


def test_removing_a_site_also_removes_its_private_draft(seeded, client):
    assert client.put(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH, json={
        "definition": edited_definition(client), "expected_revision": 0, "base_version": 1,
    }).status_code == 200
    assert manage.main(["remove-site", "--site-id", "dev-site", "--confirm", "dev-site"]) == 0
    assert client.get(f"{EDITOR_URL}/sites/dev-site/draft", headers=AUTH).status_code == 404
