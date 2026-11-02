import io
import json
import re
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.annotations import capture_group
from app.main import app
from app.services.cv_service import cv_service


def upload(client, headers, color="blue", filename="sample.png"):
    data = io.BytesIO()
    Image.new("RGB", (100, 80), color).save(data, format="PNG")
    response = client.post("/api/operator/annotations/demo/images", headers=headers, files={"image": (filename, data.getvalue(), "image/png")})
    assert response.status_code == 200
    return response.json()


def test_reviewed_image_uses_filename_date_without_manual_capture_session(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    client, headers = TestClient(app), {"Authorization": "Bearer test"}
    sample = upload(client, headers, filename="20261028_1103.png")
    response = client.put("/api/operator/annotations/demo/samples/" + sample["id"], headers=headers, json={
        "expected_revision": 0, "split": "train", "reviewed": True, "annotations": [],
    })
    assert response.status_code == 200, response.text
    assert response.json()["session"] == "date:2026-10-28"
    other = upload(client, headers, color="red", filename="20261028_1521.png")
    different_time = client.put("/api/operator/annotations/demo/samples/" + other["id"], headers=headers, json={
        "expected_revision": 0, "split": "test", "reviewed": True, "annotations": [],
    })
    assert different_time.status_code == 422
    next_day = upload(client, headers, color="green", filename="20261029_0931.png")
    independent_day = client.put("/api/operator/annotations/demo/samples/" + next_day["id"], headers=headers, json={
        "expected_revision": 0, "split": "test", "reviewed": True, "annotations": [],
    })
    assert independent_day.status_code == 200


@pytest.mark.parametrize(("filename", "expected"), [
    ("2026-10-28_11-03.jpg", "date:2026-10-28"),
    ("IMG_20261028_110300.jpg", "date:2026-10-28"),
    ("28-10-2026_1103.png", "date:2026-10-28"),
    ("20260230_1103.png", "undated"),
    ("photo.png", "undated"),
])
def test_capture_group_uses_valid_calendar_dates(filename, expected):
    assert capture_group(filename) == expected


def test_image_and_reviewed_labels_survive_reload_and_export(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "annotation-test")
    # Configure storage only for the test; API clients cannot choose filesystem paths.
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    client = TestClient(app)
    headers = {"Authorization": "Bearer annotation-test"}
    image = io.BytesIO()
    Image.new("RGB", (100, 80), "red").save(image, format="PNG")
    root = "/api/operator/annotations/demo"
    uploaded = client.post(root + "/images", headers=headers, files={"image": ("photo.png", image.getvalue(), "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    sample = uploaded.json()
    saved = client.put(root + "/samples/" + sample["id"], headers=headers, json={
        "expected_revision": sample["revision"], "session": "morning-1", "split": "train", "reviewed": True,
        "annotations": [{"id": "bike-1", "bbox": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.5},
                         "ground_point": {"x": 0.3, "y": 0.65}, "occluded": True}],
    })
    assert saved.status_code == 200, saved.text
    assert client.get(root, headers=headers).json()[0] == saved.json()
    exported = client.post(root + "/export", headers=headers)
    assert exported.status_code == 200, exported.text
    assert exported.json()["ready_for_training"] is False
    path = tmp_path / "demo" / "exports" / exported.json()["export_id"]
    assert (path / "train/labels/demo_0001.txt").read_text().strip() == "0 0.30000000 0.45000000 0.40000000 0.50000000"
    assert (path / "sessions.json").is_file()
    metadata = json.loads((path / "annotations/demo_0001.json").read_text())
    assert metadata["id"] == sample["id"] and metadata["filename"] == "photo.png"
    assert metadata["annotations"][0]["occluded"] is True
    assert metadata["annotations"][0]["ground_point"] == {"x": 0.3, "y": 0.65}


def test_export_names_files_by_dataset_number_and_folder_by_timestamp(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    client, headers = TestClient(app), {"Authorization": "Bearer test"}
    root = "/api/operator/annotations/demo"
    # Uploaded out of name order and across splits; numbering follows original filename, not hash or split.
    for color, filename, split in (("red", "20261029_b.png", "val"), ("blue", "20261028_a.png", "train"), ("green", "20261030_c.png", "test")):
        sample = upload(client, headers, color, filename)
        response = client.put(root + "/samples/" + sample["id"], headers=headers, json={
            "expected_revision": 0, "split": split, "reviewed": True, "annotations": [],
        })
        assert response.status_code == 200, response.text
    first, second = client.post(root + "/export", headers=headers).json(), client.post(root + "/export", headers=headers).json()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{6}(_\d+)?", first["export_id"])
    assert first["export_id"] != second["export_id"]  # Same-second exports never overwrite each other.
    assert first["path"].endswith("/exports/" + first["export_id"])
    path = tmp_path / "demo" / "exports" / first["export_id"]
    assert [p.name for p in sorted(path.glob("*/images/*.png"))] == ["demo_0003.png", "demo_0001.png", "demo_0002.png"]
    assert sorted(p.name for p in path.glob("*/labels/*.txt")) == ["demo_0001.txt", "demo_0002.txt", "demo_0003.txt"]
    assert (path / "train/images/demo_0001.png").is_file() and (path / "val/images/demo_0002.png").is_file()
    assert json.loads((path / "sessions.json").read_text()) == {
        "demo_0001": "date:2026-10-28", "demo_0002": "date:2026-10-29", "demo_0003": "date:2026-10-30"}


def test_label_guards_revision_session_split_and_review(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    client, headers = TestClient(app), {"Authorization": "Bearer test"}
    root = "/api/operator/annotations/demo"
    first, second = upload(client, headers), upload(client, headers, "red")
    assert client.post(root + "/export", headers=headers).status_code == 422
    payload = {"expected_revision": 0, "session": "same-session", "split": "train", "reviewed": True, "annotations": []}
    assert client.put(root + "/samples/" + first["id"], headers=headers, json=payload).status_code == 200
    assert client.put(root + "/samples/" + first["id"], headers=headers, json=payload).status_code == 409
    assert client.put(root + "/samples/" + second["id"], headers=headers, json={**payload, "split": "test"}).status_code == 422
    invalid = {"id": "box", "bbox": {"x": 0.9, "y": 0.2, "width": 0.2, "height": 0.2}, "occluded": False}
    assert client.put(root + "/samples/" + second["id"], headers=headers, json={**payload, "annotations": [invalid]}).status_code == 422


def test_annotation_requires_auth_and_rejects_fake_images(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    client = TestClient(app)
    assert client.get("/api/operator/annotations/demo").status_code == 401
    assert not (tmp_path / "demo").exists()
    bad = client.post("/api/operator/annotations/demo/images", headers={"Authorization": "Bearer test"}, files={"image": ("bad.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 422


def test_yolo_only_proposes_unconfirmed_labels_without_changing_saved_work(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    # Controlled adapter at the external inference boundary; no real weights loaded.
    monkeypatch.setattr(cv_service, "analyze_image", lambda _: SimpleNamespace(detections=[SimpleNamespace(bbox=SimpleNamespace(x=0.1, y=0.2, width=0.3, height=0.4))]))
    client, headers = TestClient(app), {"Authorization": "Bearer test"}
    sample = upload(client, headers)
    root = "/api/operator/annotations/demo"
    proposed = client.post(root + "/samples/" + sample["id"] + "/detect", headers=headers)
    assert proposed.status_code == 200
    assert proposed.json()[0]["ground_point"] is None
    assert client.get(root, headers=headers).json()[0]["annotations"] == []


def test_uploaded_orientation_and_saved_pixels_share_one_coordinate_system(tmp_path, monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test")
    monkeypatch.setenv("PARKMAP_DATASET_ROOT", str(tmp_path))
    original = Image.new("RGB", (100, 80), "red")
    exif = Image.Exif()
    exif[274] = 6
    buffer = io.BytesIO()
    original.save(buffer, format="JPEG", exif=exif)
    client, headers = TestClient(app), {"Authorization": "Bearer test"}
    response = client.post("/api/operator/annotations/demo/images", headers=headers, files={"image": ("photo.jpg", buffer.getvalue(), "image/jpeg")})
    assert response.status_code == 200
    sample = response.json()
    assert (sample["width"], sample["height"]) == (80, 100)
    stored = client.get("/api/operator/annotations/demo/images/" + sample["id"], headers=headers)
    with Image.open(io.BytesIO(stored.content)) as image:
        assert image.size == (80, 100)
        assert image.getexif().get(274) is None
