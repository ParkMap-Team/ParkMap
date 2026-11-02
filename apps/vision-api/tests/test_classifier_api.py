import hashlib
import io
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import classifier
from app.main import app


def test_analyze_detects_once_and_classifies_the_same_boxes(monkeypatch):
    from app.models import DetectionResponse

    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    calls = []
    detection = DetectionResponse(image_width=40, image_height=20, model={"name": "fixture"},
                                  inference={"imgsz": 640, "confidence_threshold": .25, "nms_iou": .45, "processing_time_ms": 1},
                                  detections=[{"class_id": 0, "class_name": "motorcycle", "confidence": .9,
                                               "bbox": {"x": .1, "y": .2, "width": .3, "height": .4}}])
    def detect(raw):
        calls.append("detect")
        return detection
    def classify(image, model, mode, boxes):
        calls.append("classify")
        assert image.size == (40, 20)
        assert boxes == [detection.detections[0].bbox.model_dump()]
        return classifier.ClassifierResult(model_id=model, image_width=40, image_height=20, preview_url="data:image/jpeg;base64,", crops=[])
    monkeypatch.setattr(classifier.cv_service, "analyze_image", detect)
    monkeypatch.setattr(classifier, "classify", classify)
    stream = io.BytesIO()
    Image.new("RGB", (40, 20)).save(stream, "PNG")
    client = TestClient(app, headers={"Authorization": "Bearer test-key"})
    response = client.post("/api/operator/classifier/analyze", data={"model_id": "fixture", "include_parking": "false"}, files={"image": ("a.png", stream.getvalue(), "image/png")})
    assert response.status_code == 200
    assert calls == ["detect", "classify"]
    assert response.json()["detection"]["detections"][0]["confidence"] == .9
    assert response.json()["classification"]["model_id"] == "fixture"
    assert response.headers["cache-control"] == "no-store"
    from app.services.parking_analysis_service import ParkingCalibrationUnavailableError

    def missing_calibration(*args):
        raise ParkingCalibrationUnavailableError("not set up")
    monkeypatch.setattr(classifier.parking_analysis_service, "analyze", missing_calibration)
    uncalibrated = client.post("/api/operator/classifier/analyze", data={"model_id": "fixture"}, files={"image": ("a.png", stream.getvalue(), "image/png")})
    assert uncalibrated.status_code == 200
    assert uncalibrated.json()["parking_error"]
    assert uncalibrated.json()["classification"]["model_id"] == "fixture"
    def unavailable(*args):
        raise ValueError("missing checkpoint")
    monkeypatch.setattr(classifier, "classify", unavailable)
    partial = client.post("/api/operator/classifier/analyze", data={"model_id": "fixture", "include_parking": "false"}, files={"image": ("a.png", stream.getvalue(), "image/png")})
    assert partial.status_code == 200
    assert partial.json()["detection"]["detections"]
    assert partial.json()["classification"] is None
    assert partial.json()["classification_error"]


@pytest.mark.parametrize("architecture", ["efficientnet_b0", "yolo11n_cls"])
def test_operator_can_predict_with_a_classifier_checkpoint(tmp_path, monkeypatch, architecture):
    import torch
    from torchvision import models

    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    monkeypatch.setattr(classifier, "RUNS", tmp_path)
    monkeypatch.setattr(classifier, "_cache", None)
    folder = tmp_path / "train-fixture"
    (folder / "val").mkdir(parents=True)
    if architecture == "yolo11n_cls":
        from ultralytics.nn.tasks import ClassificationModel

        model = ClassificationModel("yolo11n-cls.yaml", nc=1000, verbose=False)
        head = model.model[-1]
        head.linear = torch.nn.Linear(head.linear.in_features, 3)
        linear = head.linear
    else:
        model = models.efficientnet_b0(weights=None)
        model.classifier[-1] = torch.nn.Linear(model.classifier[-1].in_features, 3)
        linear = model.classifier[-1]
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.zero_()
        linear.bias.copy_(torch.tensor([0., 1., 2.]))
    classes = ["a", "b", "c"]
    checkpoint = folder / "best.pt"
    is_yolo = architecture == "yolo11n_cls"
    torch.save({"format_version": 1, "architecture": architecture, "classes": classes, "image_size": 64,
                "preprocessing": {"protocol": "letterbox_rgb_v1", "mean": [0., 0., 0.] if is_yolo else [.485, .456, .406], "std": [1., 1., 1.] if is_yolo else [.229, .224, .225], "padding_rgb": [124, 116, 104]},
                "state_dict": {("network." + key if is_yolo else key): value for key, value in model.state_dict().items()}}, checkpoint)
    digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    (folder / "run.json").write_text(json.dumps({"run_state": "complete", "best_epoch": 1, "dataset": {"classes": classes},
                                                "options": {"architecture": architecture}, "best_checkpoint_sha256": digest}))
    (folder / "val/metrics.json").write_text(json.dumps({"top1": .5}))
    stream = io.BytesIO()
    Image.new("RGB", (40, 20), "blue").save(stream, "PNG")
    client = TestClient(app, headers={"Authorization": "Bearer test-key"})
    listed = client.get("/api/operator/classifier/models")
    assert listed.status_code == 200
    assert architecture in listed.json()[0]["label"]
    response = client.post("/api/operator/classifier/predict", data={"model_id": "train-fixture", "mode": "crop"},
                           files={"image": ("motorcycle.png", stream.getvalue(), "image/png")})
    assert response.status_code == 200
    predictions = response.json()["crops"][0]["top3"]
    assert [r["family"] for r in predictions] == ["c", "b", "a"]
    assert abs(predictions[0]["score"] - .66524096) < 1e-6


def test_classifier_imports_from_the_shallow_container_layout(monkeypatch):
    name = "app._classifier_container_layout"
    module = ModuleType(name)
    module.__file__ = str(Path("/app/app/classifier.py"))
    monkeypatch.setitem(sys.modules, name, module)
    source = Path(classifier.__file__).read_text(encoding="utf-8")
    exec(compile(source, module.__file__, "exec"), module.__dict__)  # noqa: S102 - trusted module source under a simulated container path
    assert module.RUNS == Path("/tools/yolo-training/classification/runs").resolve()


def test_classifier_routes_are_operator_only(monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    client = TestClient(app)
    assert client.get("/api/operator/classifier/models").status_code == 401
    assert client.post("/api/operator/classifier/analyze").status_code == 401


def test_classifier_rejects_invalid_images_and_unknown_models(monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    client = TestClient(app, headers={"Authorization": "Bearer test-key"})
    assert client.post("/api/operator/classifier/predict", data={"model_id": "x"}, files={"image": ("x.png", b"bad", "image/png")}).status_code == 400
    data = io.BytesIO()
    Image.new("RGB", (30, 20)).save(data, "PNG")
    response = client.post("/api/operator/classifier/predict", data={"model_id": "../../secret", "mode": "crop"}, files={"image": ("x.png", data.getvalue(), "image/png")})
    assert response.status_code == 404


def test_classifier_prediction_is_ephemeral_and_oriented(monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    def run(image, model_id, mode):
        assert image.size == (20, 30)
        assert model_id == "test-run" and mode == "crop"
        return classifier.ClassifierResult(model_id=model_id, image_width=20, image_height=30,
                                           preview_url="data:image/jpeg;base64,", crops=[])
    monkeypatch.setattr(classifier, "classify", run)
    stream = io.BytesIO()
    photo = Image.new("RGB", (30, 20))
    exif = photo.getexif()
    exif[274] = 6
    photo.save(stream, "JPEG", exif=exif)
    client = TestClient(app, headers={"Authorization": "Bearer test-key"})
    response = client.post("/api/operator/classifier/predict", data={"model_id": "test-run", "mode": "crop"}, files={"image": ("real.jpg", stream.getvalue(), "image/jpeg")})
    assert response.status_code == 200
    assert response.json()["status"] == "EXPERIMENTAL"
    assert response.headers.get("cache-control") == "no-store"
