import cv2
import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from ultralytics.engine.results import Boxes

from app.main import app
from app.services import video_classifier
from app.services.video_classifier import TrackEvidence, crop_bounds, sample_indices


def test_video_classification_uses_sampled_frames_and_padded_crops():
    assert list(sample_indices(30, 60, 2)) == [0, 15, 30, 45]
    assert crop_bounds((0, 20, 100, 60), 200, 100) == (0, 18, 105, 62)


def test_track_decision_averages_all_classes_and_rejects_weak_evidence():
    evidence = TrackEvidence()
    evidence.add(0.0, [0.80, 0.15, 0.05])
    assert evidence.summary(1, ["A", "B", "C"]).family is None
    evidence.add(0.5, [0.20, 0.70, 0.10])
    evidence.add(1.0, [0.85, 0.10, 0.05])
    result = evidence.summary(1, ["A", "B", "C"])
    assert (result.family, result.observations) == ("A", 3)
    assert result.top3[0].score == pytest.approx(1.85 / 3)

    weak = TrackEvidence()
    for time in range(3):
        weak.add(time, [0.45, 0.40, 0.15])
    assert weak.summary(2, ["A", "B", "C"]).family is None


def test_operator_upload_tracks_two_motorcycles_across_sampled_frames(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "video-test-token")
    path = tmp_path / "fixture.mp4"
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (160, 80)
    )
    assert writer.isOpened()
    try:
        for _ in range(15):
            frame = np.zeros((80, 160, 3), dtype=np.uint8)
            frame[20:60, 10:50] = (0, 0, 255)
            frame[20:60, 100:140] = (255, 0, 0)
            writer.write(frame)
    finally:
        writer.release()

    calls = []

    def detect(frame, *, max_detections, detection_only):
        assert detection_only
        calls.append(frame.shape)
        from types import SimpleNamespace

        boxes = Boxes(
            torch.tensor([[10, 20, 50, 60, 0.9, 0], [100, 20, 140, 60, 0.9, 0]]),
            (80, 160),
        )
        return [SimpleNamespace(boxes=boxes)]

    def load(model_id, *, standalone_convnext):
        assert model_id == "train-20261112-005242-convnext-ft-6ea9a9"
        assert standalone_convnext
        return None, ["Red", "Blue"], 224, (0, 0, 0), None

    def classify(crop, *_):
        red, _, blue = crop.getpixel((crop.width // 2, crop.height // 2))
        return torch.tensor([0.9, 0.1] if red > blue else [0.2, 0.8])

    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", detect)
    monkeypatch.setattr(video_classifier, "load_model", load)
    monkeypatch.setattr(video_classifier, "crop_probabilities", classify)
    with TestClient(app) as client:
        upload = {"video": ("fixture.mp4", path.read_bytes(), "video/mp4")}
        assert (
            client.post("/api/operator/classifier/video", files=upload).status_code
            == 401
        )
        response = client.post(
            "/api/operator/classifier/video",
            files=upload,
            data={"fps": "2"},
            headers={"Authorization": "Bearer video-test-token"},
        )
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["sampled_frames"] == len(calls) == 3
    tracks = response.json()["tracks"]
    assert [
        (track["family"], track["observations"], track["last_time"]) for track in tracks
    ] == [
        ("Red", 3, 1.0),
        ("Blue", 3, 1.0),
    ]
