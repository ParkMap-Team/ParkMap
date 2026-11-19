import base64
import json
from io import BytesIO
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
import torch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from ultralytics.engine.results import Boxes

from app.main import app
from app.services import guard_booth_clip, video_classifier
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


def test_captured_frame_returns_motorcycle_boxes_without_tracking_or_classifying(
    monkeypatch,
):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "frame-test-token")
    calls = []

    def predict(frame, *, detection_only, imgsz=None):
        assert detection_only
        calls.append((frame.size, imgsz))
        boxes = Boxes(
            torch.tensor([[8, 4, 24, 12, 0.9, 0], [0, 0, 10, 10, 0.8, 9]]), (20, 40)
        )
        return [SimpleNamespace(boxes=boxes)]

    def forbidden(*args):
        pytest.fail("Frame detection must not track or classify")

    monkeypatch.setattr(video_classifier.video_detector, "class_id", 0)
    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", predict)
    monkeypatch.setattr(video_classifier, "video_tracker", forbidden)
    monkeypatch.setattr(video_classifier, "load_model", forbidden)
    with BytesIO() as stream:
        Image.new("RGB", (40, 20)).save(stream, "JPEG")
        files = {"image": ("frame.jpg", stream.getvalue(), "image/jpeg")}
    url = "/api/operator/classifier/detect-frame"
    with TestClient(app) as client:
        assert client.post(url, files=files).status_code == 401
        response = client.post(
            url, files=files, headers={"Authorization": "Bearer frame-test-token"}
        )
        wide = client.post(
            url,
            files=files,
            data={"mode": "wide"},
            headers={"Authorization": "Bearer frame-test-token"},
        )
        invalid = client.post(
            url,
            files=files,
            data={"mode": "arbitrary"},
            headers={"Authorization": "Bearer frame-test-token"},
        )
    assert response.status_code == 200, response.text
    assert wide.status_code == 200, wide.text
    assert response.json()["inference"]["imgsz"] == 640
    assert response.json()["mode"] == "near"
    assert response.json()["crop_padding_ratio"] == 0.05
    assert response.json()["max_selected_boxes"] == 60
    assert wide.json()["mode"] == "wide"
    assert invalid.status_code == 422
    assert response.headers["Cache-Control"] == "no-store"
    assert calls == [((40, 20), 640), ((40, 20), None)]
    [detection] = response.json()["detections"]
    assert detection["class_name"] == "motorcycle"
    assert detection["bbox"] == pytest.approx(
        {"x": 0.2, "y": 0.2, "width": 0.4, "height": 0.4}
    )


def test_selected_segmentation_model_supplies_frame_boxes(monkeypatch):
    from app.services.segmentation_experiment_service import (
        SegmentationExperimentResult,
    )

    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "frame-test-token")
    calls = []

    def segment(frame, *, imgsz):
        calls.append((frame.size, imgsz))
        return SegmentationExperimentResult(
            model="selected-seg",
            image_width=40,
            image_height=20,
            imgsz=640,
            processing_time_ms=1,
            detections=[
                {
                    "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                    "confidence": 0.95,
                }
            ],
        )

    def wrong_model(*args, **kwargs):
        pytest.fail("The box-only detector should not run for a Seg selection")

    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", wrong_model)
    monkeypatch.setattr(
        video_classifier.parking_segmentation_service, "analyze_frame", segment
    )
    with BytesIO() as stream:
        Image.new("RGB", (40, 20)).save(stream, "JPEG")
        files = {"image": ("frame.jpg", stream.getvalue(), "image/jpeg")}
    with TestClient(
        app, headers={"Authorization": "Bearer frame-test-token"}
    ) as client:
        result = client.post(
            "/api/operator/classifier/detect-frame",
            files=files,
            data={"detector": "yolo26n-seg"},
        )
        still = client.post(
            "/api/operator/classifier/analyze",
            files=files,
            data={
                "primary_detector": "segmentation",
                "segmentation_model": "yolo26n-seg",
                "include_parking": "false",
            },
        )
    assert result.status_code == 200, result.text
    assert result.json()["model"]["name"] == "selected-seg"
    assert result.json()["detections"][0]["bbox"]["width"] == 0.3
    assert still.status_code == 200, still.text
    assert still.json()["segmentation"]["imgsz"] == 640
    assert calls == [((40, 20), 640), ((40, 20), 640)]


def test_classify_selected_maps_results_to_the_reviewed_boxes(monkeypatch):
    monkeypatch.setenv("PARKMAP_EDITOR_TOKEN", "frame-test-token")
    calls = []
    saved = []

    def save(review_id, clip_id, frame_time_seconds, selections, result):
        saved.append((review_id, clip_id, frame_time_seconds, selections, result))

    monkeypatch.setattr(
        video_classifier, "save_frame_classification", save, raising=False
    )

    def model(model_id, *, standalone_convnext):
        assert model_id == video_classifier.MODEL_ID and standalone_convnext
        return None, ["Red", "Blue"], 224, (124, 116, 104), None

    def classify(crop, _model, size, _padding, _transform):
        color = crop.getpixel((crop.width // 2, crop.height // 2))
        calls.append((crop.size, size))
        return torch.tensor([0.9, 0.1] if color[0] > color[2] else [0.45, 0.55])

    def forbidden(*args, **kwargs):
        pytest.fail("Classify Selected should not rerun the detector")

    monkeypatch.setattr(video_classifier, "load_model", model)
    monkeypatch.setattr(video_classifier, "crop_probabilities", classify)
    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", forbidden)
    frame = Image.new("RGB", (100, 50), "red")
    frame.paste("blue", (50, 0, 100, 50))
    with BytesIO() as stream:
        frame.save(stream, "JPEG")
        files = {"image": ("frame.jpg", stream.getvalue(), "image/jpeg")}
    boxes = [
        {"id": 5, "bbox": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
        {"id": 9, "bbox": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
    ]
    url = "/api/operator/classifier/classify-frame"
    with TestClient(
        app, headers={"Authorization": "Bearer frame-test-token"}
    ) as client:
        invalid = client.post(
            url, files=files, data={"boxes": json.dumps([boxes[0], boxes[0]])}
        )
        assert invalid.status_code == 422
        outside = {"id": 3, "bbox": {"x": 0.9, "y": 0, "width": 0.5, "height": 1}}
        assert (
            client.post(
                url, files=files, data={"boxes": json.dumps([outside])}
            ).status_code
            == 422
        )
        assert not calls
        result = client.post(
            url,
            files=files,
            data={
                "boxes": json.dumps(boxes),
                "review_id": "7d872151-a3f1-4cd2-a235-524c748a604e",
                "clip_id": "2f135fde-51d6-4dd7-9ccb-0c9ff044db89",
                "frame_time_seconds": "5.25",
            },
        )
    assert result.status_code == 200, result.text
    assert result.headers["Cache-Control"] == "no-store"
    assert result.json()["saved_review_id"] == "7d872151-a3f1-4cd2-a235-524c748a604e"
    assert [(item["id"], item["family"]) for item in result.json()["crops"]] == [
        (5, "Red"),
        (9, None),
    ]
    assert calls == [((53, 50), 224), ((53, 50), 224)]
    [(review_id, clip_id, frame_time, selections, classification)] = saved
    assert str(review_id) == "7d872151-a3f1-4cd2-a235-524c748a604e"
    assert str(clip_id) == "2f135fde-51d6-4dd7-9ccb-0c9ff044db89"
    assert frame_time == 5.25
    assert [item.id for item in selections] == [5, 9]
    assert [item.family for item in classification.crops] == ["Red", None]


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


def test_track_preview_is_the_crop_its_leading_family_scored_highest(monkeypatch, tmp_path):
    """Not the first crop, often half outside the frame, nor a confident crop of another family."""
    path = tmp_path / "one.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (160, 80))
    assert writer.isOpened()
    try:
        for color in [(0, 0, 255)] * 5 + [(0, 255, 0)] * 5 + [(255, 0, 0)] * 5:
            frame = np.zeros((80, 160, 3), dtype=np.uint8)
            frame[20:60, 60:100] = color
            writer.write(frame)
    finally:
        writer.release()

    def detect(frame, *, max_detections, detection_only):
        return [SimpleNamespace(boxes=Boxes(torch.tensor([[60, 20, 100, 60, 0.9, 0]]), (80, 160)))]

    def dominant(image):
        return int(np.argmax(image.getpixel((image.width // 2, image.height // 2))))

    # Sampled frames: red, a confident Red; green, its most confident Red; blue, a more confident Blue.
    scores = {0: [0.60, 0.40], 1: [0.95, 0.05], 2: [0.02, 0.98]}
    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", detect)
    monkeypatch.setattr(
        video_classifier, "load_model", lambda *_, **__: (None, ["Red", "Blue"], 224, (0, 0, 0), None)
    )
    monkeypatch.setattr(video_classifier, "crop_probabilities", lambda crop, *_: torch.tensor(scores[dominant(crop)]))
    clip = video_classifier.track_clip(path, "model", 2, max_duration_s=30)

    [(track_id, track)] = clip.tracks.items()
    assert track.summary(track_id, clip.classes).top3[0].family == "Red"
    preview = Image.open(BytesIO(base64.b64decode(track.preview_url.removeprefix("data:image/jpeg;base64,"))))
    assert dominant(preview.convert("RGB")) == 1


def test_clip_length_is_capped_by_the_caller(monkeypatch, tmp_path):
    """An operator upload stops at 30 s; the Guard Booth clip may run up to its own cap."""
    path = tmp_path / "long.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 1.0, (160, 80))
    assert writer.isOpened()
    try:
        for _ in range(35):
            writer.write(np.zeros((80, 160, 3), dtype=np.uint8))
    finally:
        writer.release()

    def detect(frame, *, max_detections, detection_only):
        return [SimpleNamespace(boxes=Boxes(torch.zeros((0, 6)), (80, 160)))]

    monkeypatch.setattr(video_classifier.video_detector, "predict_frame", detect)
    monkeypatch.setattr(
        video_classifier, "load_model", lambda *_, **__: (None, ["Red"], 224, (0, 0, 0), None)
    )
    with pytest.raises(HTTPException) as rejected:
        video_classifier.track_clip(
            path, "model", 1, max_duration_s=video_classifier.MAX_VIDEO_DURATION_SECONDS
        )
    assert rejected.value.status_code == 422
    assert "up to 30 seconds" in rejected.value.detail

    clip = video_classifier.track_clip(
        path, "model", 1, max_duration_s=guard_booth_clip.MAX_CLIP_DURATION_S
    )
    assert clip.sampled_frames == 35
    assert clip.tracks == {}
