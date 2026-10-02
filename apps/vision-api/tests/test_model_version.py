import pytest

from app.services.cv_service import ComputerVisionService, ModelUnavailableError
from app.services.model_version import analysis_version_for_model


def test_analysis_version_identifies_weights_and_inference_settings(tmp_path):
    weights = tmp_path / "model.pt"
    weights.write_bytes(b"first-model")

    first = analysis_version_for_model(
        "parking-analysis-v2",
        weights,
        imgsz=960,
        confidence=0.25,
        nms_iou=0.5,
        device="cpu",
    )
    assert first.startswith("parking-analysis-v2+model-")
    assert len(first) <= 64
    assert first == analysis_version_for_model(
        "parking-analysis-v2",
        weights,
        imgsz=960,
        confidence=0.25,
        nms_iou=0.5,
        device="cpu",
    )
    assert (
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=960,
            confidence=0.3,
            nms_iou=0.5,
            device="cpu",
        )
        != first
    )
    assert (
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=960,
            confidence=0.25,
            nms_iou=0.6,
            device="cpu",
        )
        != first
    )
    assert (
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=640,
            confidence=0.25,
            nms_iou=0.5,
            device="cpu",
        )
        != first
    )

    weights.write_bytes(b"second-model")
    assert (
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=960,
            confidence=0.25,
            nms_iou=0.5,
            device="cpu",
        )
        != first
    )


def test_analysis_version_rejects_missing_weights_and_invalid_settings(tmp_path):
    weights = tmp_path / "model.pt"
    with pytest.raises(FileNotFoundError):
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=960,
            confidence=0.25,
            nms_iou=0.5,
            device="cpu",
        )

    weights.write_bytes(b"model")
    with pytest.raises(ValueError, match="Confidence and NMS IoU"):
        analysis_version_for_model(
            "parking-analysis-v2",
            weights,
            imgsz=960,
            confidence=float("nan"),
            nms_iou=0.5,
            device="cpu",
        )
    with pytest.raises(ValueError, match="64-character"):
        analysis_version_for_model(
            "a" * 42, weights, imgsz=960, confidence=0.25, nms_iou=0.5, device="cpu"
        )


def test_loaded_model_exposes_a_stable_published_version(tmp_path, monkeypatch):
    weights = tmp_path / "model.pt"
    weights.write_bytes(b"model")
    service = ComputerVisionService()
    service.model_path = weights
    monkeypatch.setattr(
        "app.services.cv_service.YOLO", lambda *args, **kwargs: object()
    )

    with pytest.raises(ModelUnavailableError):
        service.published_analysis_version("parking-analysis-v2")

    service._load_model()
    version = service.published_analysis_version("parking-analysis-v2")
    assert version.startswith("parking-analysis-v2+model-")

    weights.write_bytes(b"changed-on-disk-after-load")
    assert service.published_analysis_version("parking-analysis-v2") == version
