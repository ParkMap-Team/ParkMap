import io

from app import classifier
from app.main import app
from fastapi.testclient import TestClient
from PIL import Image


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
