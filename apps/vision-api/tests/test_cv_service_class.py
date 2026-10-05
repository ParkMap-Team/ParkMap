from io import BytesIO

import torch
from PIL import Image

from app.services.cv_service import ComputerVisionService


class _Boxes:
    def __init__(self, rows):
        values = torch.tensor(rows, dtype=torch.float32)
        self.xyxy, self.conf, self.cls = values[:, :4], values[:, 4], values[:, 5]


class _Result:
    def __init__(self, rows):
        self.boxes = _Boxes(rows)


class _Model:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        return [_Result(self.rows)]


def _image() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (100, 100)).save(buffer, format="PNG")
    return buffer.getvalue()


def _analyze(rows):
    service = ComputerVisionService()
    service._model = _Model(rows)
    return service._model, service.analyze_image(_image())


def test_detector_uses_model_class_zero_by_default(monkeypatch):
    monkeypatch.delenv("PARKMAP_MODEL_CLASS_ID", raising=False)

    model, response = _analyze([[10, 10, 50, 50, 0.9, 0], [60, 60, 90, 90, 0.8, 3]])

    assert model.calls[0]["classes"] == [0]
    assert len(response.detections) == 1


def test_configured_model_class_is_reported_as_motorcycle(monkeypatch):
    monkeypatch.setenv("PARKMAP_MODEL_CLASS_ID", "3")  # COCO-pretrained weights

    model, response = _analyze([[10, 10, 50, 50, 0.9, 3], [60, 60, 90, 90, 0.8, 0]])

    assert model.calls[0]["classes"] == [3]
    assert [(d.class_id, d.class_name, d.confidence) for d in response.detections] == [
        (0, "motorcycle", 0.8999999761581421)
    ]
