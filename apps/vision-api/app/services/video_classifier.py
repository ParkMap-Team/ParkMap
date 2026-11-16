"""Decode and classify a short operator video with one isolated tracker per clip."""

import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from typing import Annotated, Literal

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from PIL import Image
from pydantic import BaseModel

from app.classifier import (
    LOCK,
    Prediction,
    crop_probabilities,
    encode_preview,
    load_model,
)
from app.operator_auth import require_editor_token
from app.services.cv_service import (
    ComputerVisionService,
    ModelUnavailableError,
)

MAX_VIDEO_BYTES = 25 * 1024 * 1024
MAX_DURATION = 30
MODEL_ID = "train-20261112-005242-convnext-ft-6ea9a9"
DEFAULT_VIDEO_DETECTOR_WEIGHTS = (
    "../../tools/yolo-training/detection/runs/yolo26n/"
    "round-10_2026-11-09_10-04/weights/best.pt"
)
MIN_OBSERVATIONS = 3
MIN_SCORE = 0.60
VIDEO_FORMATS = {"video/mp4": ".mp4", "video/webm": ".webm"}
VIDEO_LOCK = Lock()
video_detector = ComputerVisionService(
    os.getenv("PARKMAP_VIDEO_DETECTOR_PATH") or DEFAULT_VIDEO_DETECTOR_WEIGHTS
)

router = APIRouter(
    prefix="/api/operator/classifier", dependencies=[Depends(require_editor_token)]
)


class TrackSummary(BaseModel):
    id: int
    observations: int
    first_time: float
    last_time: float
    family: str | None
    top3: list[Prediction]
    preview_url: str | None


class VideoClassification(BaseModel):
    model_id: str
    sampled_frames: int
    tracks: list[TrackSummary]


@dataclass
class TrackEvidence:
    scores: list[float] = field(default_factory=list)
    observations: int = 0
    first_time: float = 0
    last_time: float = 0
    preview_url: str | None = None

    def add(self, time: float, scores: list[float]) -> None:
        if self.observations == 0:
            self.scores = scores.copy()
            self.first_time = time
        else:
            self.scores = [
                total + score for total, score in zip(self.scores, scores, strict=True)
            ]
        self.observations += 1
        self.last_time = time

    def summary(self, track_id: int, classes: list[str]) -> TrackSummary:
        ranked = sorted(
            zip(classes, self.scores, strict=True),
            key=lambda item: item[1],
            reverse=True,
        )
        top3 = [
            Prediction(family=name, score=score / self.observations)
            for name, score in ranked[:3]
        ]
        family = (
            top3[0].family
            if self.observations >= MIN_OBSERVATIONS and top3[0].score >= MIN_SCORE
            else None
        )
        return TrackSummary(
            id=track_id,
            observations=self.observations,
            first_time=self.first_time,
            last_time=self.last_time,
            family=family,
            top3=top3,
            preview_url=self.preview_url,
        )


def sample_indices(source_fps: float, frame_count: int, fps: int):
    step = source_fps / min(source_fps, fps)
    for sample in range(math.ceil(frame_count / step)):
        yield math.floor(sample * step)


def crop_bounds(box, width: int, height: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    pad_x, pad_y = (right - left) * 0.05, (bottom - top) * 0.05
    return (
        max(0, math.floor(left - pad_x)),
        max(0, math.floor(top - pad_y)),
        min(width, math.ceil(right + pad_x)),
        min(height, math.ceil(bottom + pad_y)),
    )


def video_tracker(fps: int):
    from ultralytics.trackers.byte_tracker import BYTETracker
    from ultralytics.utils import YAML, IterableSimpleNamespace
    from ultralytics.utils.checks import check_yaml

    settings = YAML.load(check_yaml("bytetrack.yaml"))
    settings["track_buffer"] = 2 * fps
    return BYTETracker(IterableSimpleNamespace(**settings))


def classify_clip(path: Path, model_id: str, fps: int) -> VideoClassification:
    capture = cv2.VideoCapture(str(path))
    try:
        source_fps = capture.get(cv2.CAP_PROP_FPS)
        frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        width, height = (
            capture.get(cv2.CAP_PROP_FRAME_WIDTH),
            capture.get(cv2.CAP_PROP_FRAME_HEIGHT),
        )
        if (
            not capture.isOpened()
            or not all(
                math.isfinite(value)
                for value in (source_fps, frame_count, width, height)
            )
            or not 0 < source_fps <= 120
            or frame_count < 1
            or width <= 0
            or height <= 0
        ):
            raise HTTPException(
                422,
                "Unable to read the video. Export it as MP4 or WebM with a fixed frame rate.",
            )
        if frame_count / source_fps > MAX_DURATION or width * height > 8_400_000:
            raise HTTPException(
                422, "Choose a video up to 30 seconds and 8.4 megapixels per frame."
            )

        try:
            with LOCK:
                model, classes, size, padding, transform = load_model(model_id, standalone_convnext=True)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            raise HTTPException(
                503,
                f"Place best.pt in classifier run {model_id} before classifying video.",
            ) from error
        tracker = video_tracker(fps)
        evidence: dict[int, TrackEvidence] = {}
        sampled = 0
        next_frame = 0
        for index in sample_indices(source_fps, int(frame_count), fps):
            while next_frame < index and capture.grab():
                next_frame += 1
            ok, frame = capture.read()
            if not ok or next_frame != index:
                raise HTTPException(
                    422, "Video ended before all selected frames could be decoded."
                )
            next_frame += 1
            sampled += 1
            result = video_detector.predict_frame(
                frame, max_detections=60, detection_only=True
            )[0]
            boxes = result.boxes.cpu().numpy()
            for *_, track_id, _confidence, _class_id, detection_index in tracker.update(
                boxes
            ):
                track_id = int(track_id)
                if track_id not in evidence and len(evidence) >= 300:
                    raise HTTPException(422, "Too many tracks. Try a shorter video.")
                left, top, right, bottom = crop_bounds(
                    boxes.xyxy[int(detection_index)], frame.shape[1], frame.shape[0]
                )
                if left >= right or top >= bottom:
                    continue
                track = evidence.setdefault(track_id, TrackEvidence())
                rgb = cv2.cvtColor(frame[top:bottom, left:right], cv2.COLOR_BGR2RGB)
                with Image.fromarray(rgb) as crop:
                    with LOCK:
                        scores = crop_probabilities(
                            crop, model, size, padding, transform
                        ).tolist()
                    if track.preview_url is None:
                        crop.thumbnail((240, 240))
                        track.preview_url = encode_preview(crop)
                track.add(index / source_fps, scores)
        return VideoClassification(
            model_id=model_id,
            sampled_frames=sampled,
            tracks=[evidence[key].summary(key, classes) for key in sorted(evidence)],
        )
    finally:
        capture.release()


@router.post("/video", response_model=VideoClassification)
def classify_video(
    response: Response,
    video: Annotated[UploadFile, File()],
    fps: Annotated[Literal["1", "2"], Form()] = "1",
) -> VideoClassification:
    response.headers["Cache-Control"] = "no-store"
    suffix = VIDEO_FORMATS.get(video.content_type or "")
    if suffix is None:
        raise HTTPException(415, "Choose an MP4 or WebM video.")
    if video.size is not None and not 0 < video.size <= MAX_VIDEO_BYTES:
        raise HTTPException(413, "Video is empty or exceeds 25 MB.")
    if not VIDEO_LOCK.acquire(blocking=False):
        raise HTTPException(409, "A video is already being classified.")
    try:
        with TemporaryDirectory(prefix="parkmap-video-") as directory:
            path = Path(directory) / f"clip{suffix}"
            with path.open("wb") as output:
                total = 0
                while chunk := video.file.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_VIDEO_BYTES:
                        raise HTTPException(413, "Video exceeds 25 MB.")
                    output.write(chunk)
            return classify_clip(path, MODEL_ID, int(fps))
    except ModelUnavailableError as error:
        raise HTTPException(503, str(error)) from error
    except (ImportError, KeyError, OSError, RuntimeError, ValueError) as error:
        raise HTTPException(
            503,
            "Video analysis unavailable. Check the YOLO and classifier checkpoints and tracker dependencies.",
        ) from error
    finally:
        VIDEO_LOCK.release()
