import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.mobile_camera as mobile
from app.db.session import get_session
from app.main import app
from app.services.mobile_camera_sessions import MobileSessions


def jpeg(size=(80, 60)):
    stream = io.BytesIO()
    Image.new("RGB", size, "grey").save(stream, "JPEG")
    return stream.getvalue()


def test_phone_image_resize_preserves_aspect_and_rejects_invalid_inputs():
    image, preview = mobile.normalize_phone_image(jpeg(), {"width": 160, "height": 120})
    assert image.shape == (120, 160, 3)
    assert preview.startswith("data:image/jpeg;base64,")
    with pytest.raises(ValueError, match="received 80x40, expected ratio 160x120"):
        mobile.normalize_phone_image(jpeg((80, 40)), {"width": 160, "height": 120})
    with pytest.raises(ValueError, match="Invalid camera image"):
        mobile.normalize_phone_image(b"not-an-image", {"width": 160, "height": 120})


def test_phone_claim_preview_approval_and_stop_do_not_grant_editor_access(monkeypatch):
    manager = MobileSessions()
    monkeypatch.setattr(mobile, "mobile_sessions", manager)
    monkeypatch.setattr(mobile, "current_configuration", lambda: ("v1", None))
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-editor-only")
    item, pair = manager.create("area", "camera", "v1", {"reference_image": {"width": 160, "height": 120}, "rows": []})
    app.dependency_overrides[get_session] = lambda: object()  # preview must never access DB
    try:
        with TestClient(app) as client:
            claimed = client.post("/api/mobile-camera/claim", json={"pairing_token": pair})
            assert claimed.status_code == 200
            assert claimed.json()["result"] is None
            token = claimed.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            assert client.post("/api/mobile-camera/claim", json={"pairing_token": pair}).status_code == 410
            assert client.get(f"/api/operator/mobile-camera/sessions/{item.id}", headers=headers).status_code == 401
            assert client.post("/api/mobile-camera/frame", content=jpeg(), headers={**headers, "X-Frame-Sequence": "0", "Content-Type": "image/jpeg"}).json()["state"] == "AWAITING_APPROVAL"
            public = client.get("/api/mobile-camera/status", headers=headers).json()
            assert "preview_url" not in public
            private = client.get(f"/api/operator/mobile-camera/sessions/{item.id}", headers={"Authorization": "Bearer test-editor-only"}).json()
            assert private["preview_url"].startswith("data:image/jpeg")
            assert client.post(f"/api/operator/mobile-camera/sessions/{item.id}/approve", json={"preview_revision": private["preview_revision"]}, headers={"Authorization": "Bearer test-editor-only"}).status_code == 200
            assert manager.owns_area("area")
            assert client.post("/api/mobile-camera/stop", headers=headers).status_code == 200
            assert client.get("/api/mobile-camera/status", headers=headers).status_code == 410
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_active_mobile_session_prevents_photo_worker_overwriting(monkeypatch):
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app import main
    from app.manage import dev_state

    manager = MobileSessions()
    monkeypatch.setattr(main, "mobile_sessions", manager)
    monkeypatch.setenv("PARKMAP_WORKER_TOKEN", "test-worker")
    state = dev_state(datetime.now(UTC))
    item, pair = manager.create(state.parking_area_id, state.camera_id, "v1", {})
    manager.claim(pair)
    manager.preview(item, "preview", 1)
    manager.approve(item.id, 1)
    writes = []
    db = SimpleNamespace(get=lambda *_: SimpleNamespace(camera_id=state.camera_id), commit=lambda: None)
    monkeypatch.setattr(main.repository, "insert_state", lambda _db, value: writes.append(value))
    app.dependency_overrides[get_session] = lambda: db
    try:
        with TestClient(app) as client:
            assert client.post("/api/internal/parking-states", json=state.model_dump(mode="json"), headers={"Authorization": "Bearer test-worker"}).status_code == 204
            assert writes == []
            manager.stop(item.id)
            assert client.post("/api/internal/parking-states", json=state.model_dump(mode="json"), headers={"Authorization": "Bearer test-worker"}).status_code == 204
            assert len(writes) == 1
    finally:
        app.dependency_overrides.pop(get_session, None)


@pytest.mark.parametrize("revoked_during_analysis", [False, True])
def test_approved_frame_publishes_only_while_its_capability_is_still_valid(tmp_path, monkeypatch, revoked_during_analysis):
    import json
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from app.models import ParkingStatePublish

    clock = [0.]
    manager = MobileSessions(clock=lambda: clock[0])
    monkeypatch.setattr(mobile, "mobile_sessions", manager)
    monkeypatch.setattr(mobile, "current_configuration", lambda: ("v1", None))
    monkeypatch.setattr(mobile, "CONFIG", tmp_path)
    (tmp_path / "ground_plane_homography.json").write_text(json.dumps({"inverse_matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}))
    item, pair = manager.create("area", "camera", "v1", {"reference_image": {"width": 160, "height": 120}, "rows": []})
    token = manager.claim(pair)
    manager.preview(item, "preview", 1)
    manager.approve(item.id, 1)
    writes = []
    db = SimpleNamespace(get=lambda *_: SimpleNamespace(camera_id="camera"), commit=lambda: None)
    monkeypatch.setattr(mobile.repository, "active_calibrations", lambda *_: {"area": SimpleNamespace(version="v1")})
    monkeypatch.setattr(mobile.repository, "insert_state", lambda _db, value: writes.append(value))

    def analysis(image, captured_at, *, parking_area_id, source):
        assert image.shape == (120, 160, 3)
        assert source == "LIVE_CAMERA" and parking_area_id == "area"
        if revoked_during_analysis:
            manager.stop(item.id)
        return ParkingStatePublish(parking_area_id="area", camera_id="camera", source=source,
            observed_at=captured_at, processed_at=datetime.now(UTC), calibration_version="v1",
            calibration_provenance="MEASURED", analysis_version="test", regions=[], motorcycles=[])

    monkeypatch.setattr(mobile, "analyze_segmentation_frame", analysis)
    app.dependency_overrides[get_session] = lambda: db
    try:
        with TestClient(app) as client:
            response = client.post("/api/mobile-camera/frame", content=jpeg(), headers={
                "Authorization": f"Bearer {token}", "Content-Type": "image/jpeg", "X-Frame-Sequence": "0"})
            assert response.status_code == (410 if revoked_during_analysis else 200)
            assert len(writes) == (0 if revoked_during_analysis else 1)
            if writes:
                assert writes[0].source == "LIVE_CAMERA"
    finally:
        app.dependency_overrides.pop(get_session, None)
