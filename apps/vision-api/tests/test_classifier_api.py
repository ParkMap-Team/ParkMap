import hashlib
import io
import json
import sys
from pathlib import Path
from types import ModuleType

from fastapi.testclient import TestClient
from PIL import Image

from app import classifier
from app.main import app


def test_operator_can_predict_with_an_efficientnet_checkpoint(tmp_path, monkeypatch):
    import torch
    from torchvision import models

    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "test-key")
    monkeypatch.setattr(classifier, "RUNS", tmp_path)
    monkeypatch.setattr(classifier, "_cache", None)
    folder = tmp_path / "train-fixture"
    (folder / "val").mkdir(parents=True)
    model = models.efficientnet_b0(weights=None)
    model.classifier[-1] = torch.nn.Linear(model.classifier[-1].in_features, 3)
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.zero_()
        model.classifier[-1].bias.copy_(torch.tensor([0., 1., 2.]))
    classes = ["a", "b", "c"]
    checkpoint = folder / "best.pt"
    torch.save({"format_version": 1, "architecture": "efficientnet_b0", "classes": classes, "image_size": 64,
                "preprocessing": {"protocol": "letterbox_rgb_v1", "mean": [.485, .456, .406], "std": [.229, .224, .225], "padding_rgb": [124, 116, 104]},
                "state_dict": model.state_dict()}, checkpoint)
    digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    (folder / "run.json").write_text(json.dumps({"run_state": "complete", "best_epoch": 1, "dataset": {"classes": classes},
                                                "options": {"architecture": "efficientnet_b0"}, "best_checkpoint_sha256": digest}))
    (folder / "val/metrics.json").write_text(json.dumps({"top1": .5}))
    stream = io.BytesIO()
    Image.new("RGB", (40, 20), "blue").save(stream, "PNG")
    client = TestClient(app, headers={"Authorization": "Bearer test-key"})
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
