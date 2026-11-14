import io
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from PIL import Image

from app.services.cv_service import ModelUnavailableError
from app.services.segmentation_experiment_service import SegmentationExperimentService


def image():
    stream = io.BytesIO()
    Image.new("RGB", (100, 50)).save(stream, "PNG")
    return stream.getvalue()


def test_segmentation_keeps_motorcycle_masks_aligned_with_boxes(monkeypatch):
    service = SegmentationExperimentService()
    polygons = [np.array([[.1, .1], [.4, .1], [.4, .6]]), np.array([[0., 0.], [.1, 0.], [.1, .1]]),
                np.array([[.6, .2], [.9, .2], [.9, .8]])]
    result = SimpleNamespace(boxes=SimpleNamespace(xyxy=torch.tensor([[10., 5., 40., 30.], [0., 0., 10., 5.], [60., 10., 90., 40.]]),
        conf=torch.tensor([.9, .8, .7]), cls=torch.tensor([3, 0, 3])), masks=SimpleNamespace(xyn=polygons))
    def predict(**kwargs):
        assert kwargs["classes"] == [3]
        return [result]
    monkeypatch.setattr(service, "_load_model", lambda: SimpleNamespace(predict=predict))
    answer = service.analyze_image(image())
    assert (answer.image_width, answer.image_height) == (100, 50)
    assert len(answer.detections) == 2
    assert answer.detections[0].bbox.x == pytest.approx(.1)
    assert answer.detections[1].polygon[0].x == .6
    assert answer.detections[1].polygon[0].y == .2
    result.masks = None
    missing = service.analyze_image(image())
    assert len(missing.detections) == 2
    assert all(item.polygon is None for item in missing.detections)
    result.masks = SimpleNamespace(xyn=[np.array([[float("nan"), .1], [.2, .2], [.3, .3]])])
    assert service.analyze_image(image()).detections[0].polygon is None


def test_missing_weights_fail_without_downloading(tmp_path):
    service = SegmentationExperimentService()
    service.model_path = tmp_path / "missing.pt"
    with pytest.raises(ModelUnavailableError):
        service.analyze_image(image())


@pytest.mark.parametrize("task,names", [("detect", {3: "motorcycle"}), ("segment", {3: "person"})])
def test_segmentation_rejects_wrong_task_or_class(tmp_path, monkeypatch, task, names):
    from app.services import segmentation_experiment_service as module

    service = SegmentationExperimentService()
    service.model_path = tmp_path / "fixture.pt"
    service.model_path.write_bytes(b"fixture")
    monkeypatch.setattr(module, "YOLO", lambda *args, **kwargs: SimpleNamespace(task=task, names=names))
    with pytest.raises(ModelUnavailableError):
        service._load_model()
    assert service._model is None
