"""Decode and classify a short operator video with one isolated tracker per clip."""

import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from typing import Annotated, Literal
from uuid import UUID, uuid4

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from PIL import Image
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.classifier import (
    LOCK,
    Prediction,
    crop_probabilities,
    encode_preview,
    load_model,
    read_image,
)
from app.db.session import DatabaseNotConfiguredError, open_session
from app.db.tables import FrameCropClassification
from app.models import DetectionBBox, DetectionResponse
from app.operator_auth import require_editor_token
from app.parking_inference_settings import (
    BOX_BOUNDARY_TOLERANCE,
    BOX_WEIGHTS,
    CROP_PADDING_RATIO,
    DEFAULT_FRAME_MODE,
    MAX_OPERATOR_UPLOAD_BYTES,
    MAX_OPERATOR_UPLOAD_MIB,
    MAX_SELECTED_BOXES,
    MAX_SELECTION_JSON_LENGTH,
    MAX_SOURCE_FPS,
    MAX_TRACK_DETECTIONS,
    MAX_TRACKS,
    MAX_VIDEO_DURATION_SECONDS,
    MAX_VIDEO_FRAME_PIXELS,
    MIN_OBSERVATIONS,
    MIN_SCORE,
    MODEL_ID,
    NEAR_FRAME_IMGSZ,
    SELECTED_CROP_PREVIEW_SIZE,
    TOP_PREDICTIONS,
    TRACK_BUFFER_SECONDS,
    TRACK_CROP_PREVIEW_SIZE,
    UPLOAD_READ_CHUNK_BYTES,
    VIDEO_FORMATS,
    DetectionMode,
)
from app.services.cv_service import (
    ComputerVisionService,
    ModelUnavailableError,
)
from app.services.segmentation_experiment_service import parking_segmentation_service

VIDEO_LOCK = Lock()
video_detector = ComputerVisionService(
    os.getenv("PARKMAP_VIDEO_DETECTOR_PATH") or str(BOX_WEIGHTS),
    class_id_env="PARKMAP_VIDEO_DETECTOR_CLASS_ID",
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


class SelectedFrameBox(BaseModel):
    id: int = Field(gt=0)
    bbox: DetectionBBox
    confidence: float | None = Field(default=None, ge=0, le=1)


class SelectedFrameCrop(BaseModel):
    id: int
    family: str | None
    top3: list[Prediction]
    crop_url: str


class SelectedFrameClassification(BaseModel):
    crops: list[SelectedFrameCrop]


class SavedFrameClassification(SelectedFrameClassification):
    saved_review_id: UUID


class FrameDetectionResponse(DetectionResponse):
    mode: DetectionMode
    crop_padding_ratio: float = CROP_PADDING_RATIO
    max_selected_boxes: int = MAX_SELECTED_BOXES


FRAME_SELECTION = TypeAdapter(
    Annotated[
        list[SelectedFrameBox], Field(min_length=1, max_length=MAX_SELECTED_BOXES)
    ]
)


@dataclass(frozen=True)
class TrackPoint:
    """Bottom centre of a tracked box, normalized to the frame: roughly where the wheels meet the ground."""

    time: float
    x: float
    y: float


@dataclass
class TrackEvidence:
    scores: list[float] = field(default_factory=list)
    observations: int = 0
    first_time: float = 0
    last_time: float = 0
    preview_url: str | None = None
    path: list[TrackPoint] = field(default_factory=list)

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
            for name, score in ranked[:TOP_PREDICTIONS]
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
    pad_x, pad_y = (
        (right - left) * CROP_PADDING_RATIO,
        (bottom - top) * CROP_PADDING_RATIO,
    )
    return (
        max(0, math.floor(left - pad_x)),
        max(0, math.floor(top - pad_y)),
        min(width, math.ceil(right + pad_x)),
        min(height, math.ceil(bottom + pad_y)),
    )


def classify_frame_crops(
    frame: Image.Image, selections: list[SelectedFrameBox]
) -> SelectedFrameClassification:
    crops = []
    with LOCK:
        model, classes, size, padding, transform = load_model(
            MODEL_ID, standalone_convnext=True
        )
        for item in selections:
            box = item.bbox
            bounds = crop_bounds(
                (
                    box.x * frame.width,
                    box.y * frame.height,
                    (box.x + box.width) * frame.width,
                    (box.y + box.height) * frame.height,
                ),
                frame.width,
                frame.height,
            )
            with frame.crop(bounds) as crop:
                scores, indices = crop_probabilities(
                    crop, model, size, padding, transform
                ).topk(min(TOP_PREDICTIONS, len(classes)))
                top3 = [
                    Prediction(family=classes[index], score=score)
                    for score, index in zip(
                        scores.tolist(), indices.tolist(), strict=True
                    )
                ]
                crop.thumbnail(SELECTED_CROP_PREVIEW_SIZE)
                crops.append(
                    SelectedFrameCrop(
                        id=item.id,
                        family=top3[0].family if top3[0].score >= MIN_SCORE else None,
                        top3=top3,
                        crop_url=encode_preview(crop),
                    )
                )
    return SelectedFrameClassification(crops=crops)


def save_frame_classification(
    review_id: UUID,
    clip_id: UUID | None,
    frame_time_seconds: float | None,
    selections: list[SelectedFrameBox],
    result: SelectedFrameClassification,
) -> None:
    selections_by_id = {item.id: item for item in selections}
    rows = []
    for crop in sorted(result.crops, key=lambda item: item.id):
        selection = selections_by_id[crop.id]
        rows.append(
            {
                "review_id": review_id,
                "crop_id": crop.id,
                "frame_time_seconds": frame_time_seconds,
                "model_id": MODEL_ID,
                "payload": {
                    **crop.model_dump(mode="json"),
                    "bbox": selection.bbox.model_dump(mode="json"),
                    "detection_confidence": selection.confidence,
                    "clip_id": str(clip_id) if clip_id else None,
                },
            }
        )
    statement = insert(FrameCropClassification).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=[
            FrameCropClassification.review_id,
            FrameCropClassification.crop_id,
        ],
        set_={
            "frame_time_seconds": statement.excluded.frame_time_seconds,
            "model_id": statement.excluded.model_id,
            "payload": statement.excluded.payload,
            "saved_at": func.now(),
        },
    )
    with open_session() as session:
        session.execute(statement)
        session.commit()


def video_tracker(fps: int):
    from ultralytics.trackers.byte_tracker import BYTETracker
    from ultralytics.utils import YAML, IterableSimpleNamespace
    from ultralytics.utils.checks import check_yaml

    settings = YAML.load(check_yaml("bytetrack.yaml"))
    settings["track_buffer"] = TRACK_BUFFER_SECONDS * fps
    return BYTETracker(IterableSimpleNamespace(**settings))


@dataclass(frozen=True)
class ClipEvidence:
    sampled_frames: int
    classes: list[str]
    tracks: dict[int, TrackEvidence]


def classify_clip(path: Path, model_id: str, fps: int) -> VideoClassification:
    clip = track_clip(path, model_id, fps)
    return VideoClassification(
        model_id=model_id,
        sampled_frames=clip.sampled_frames,
        tracks=[
            clip.tracks[key].summary(key, clip.classes) for key in sorted(clip.tracks)
        ],
    )


def track_clip(path: Path, model_id: str, fps: int) -> ClipEvidence:
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
            or not 0 < source_fps <= MAX_SOURCE_FPS
            or frame_count < 1
            or width <= 0
            or height <= 0
        ):
            raise HTTPException(
                422,
                "Unable to read the video. Export it as MP4 or WebM with a fixed frame rate.",
            )
        if (
            frame_count / source_fps > MAX_VIDEO_DURATION_SECONDS
            or width * height > MAX_VIDEO_FRAME_PIXELS
        ):
            raise HTTPException(
                422,
                f"Choose a video up to {MAX_VIDEO_DURATION_SECONDS} seconds and {MAX_VIDEO_FRAME_PIXELS / 1_000_000:g} megapixels per frame.",
            )

        try:
            with LOCK:
                model, classes, size, padding, transform = load_model(
                    model_id, standalone_convnext=True
                )
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
                frame, max_detections=MAX_TRACK_DETECTIONS, detection_only=True
            )[0]
            boxes = result.boxes.cpu().numpy()
            for *_, track_id, _confidence, _class_id, detection_index in tracker.update(
                boxes
            ):
                track_id = int(track_id)
                if track_id not in evidence and len(evidence) >= MAX_TRACKS:
                    raise HTTPException(422, "Too many tracks. Try a shorter video.")
                box = boxes.xyxy[int(detection_index)]
                left, top, right, bottom = crop_bounds(
                    box, frame.shape[1], frame.shape[0]
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
                        crop.thumbnail(TRACK_CROP_PREVIEW_SIZE)
                        track.preview_url = encode_preview(crop)
                time = index / source_fps
                track.add(time, scores)
                track.path.append(
                    TrackPoint(
                        time=time,
                        x=float(box[0] + box[2]) / 2 / frame.shape[1],
                        y=float(box[3]) / frame.shape[0],
                    )
                )
        return ClipEvidence(sampled_frames=sampled, classes=classes, tracks=evidence)
    finally:
        capture.release()


@router.post("/detect-frame", response_model=FrameDetectionResponse)
async def detect_captured_frame(
    response: Response,
    image: Annotated[UploadFile, File()],
    mode: Annotated[DetectionMode, Form()] = DEFAULT_FRAME_MODE,
    detector: Annotated[Literal["yolo26n", "yolo26n-seg"], Form()] = "yolo26n",
) -> FrameDetectionResponse:
    response.headers["Cache-Control"] = "no-store"
    with await read_image(image) as frame:
        try:
            size = NEAR_FRAME_IMGSZ if mode == "near" else None
            if detector == "yolo26n-seg":
                segmented = await run_in_threadpool(
                    parking_segmentation_service.analyze_frame, frame, imgsz=size
                )
                result = parking_segmentation_service.detection_response(segmented)
            else:
                result = await run_in_threadpool(
                    video_detector.analyze_frame, frame, detection_only=True, imgsz=size
                )
            return FrameDetectionResponse(**result.model_dump(), mode=mode)
        except ModelUnavailableError as error:
            raise HTTPException(503, str(error)) from error
        except (OSError, RuntimeError, ValueError) as error:
            raise HTTPException(
                503,
                "Unable to detect motorcycles. Check the local YOLO detection model.",
            ) from error


@router.post("/classify-frame", response_model=SavedFrameClassification)
async def classify_selected_frame(
    response: Response,
    image: Annotated[UploadFile, File()],
    boxes: Annotated[str, Form(max_length=MAX_SELECTION_JSON_LENGTH)],
    review_id: Annotated[UUID | None, Form()] = None,
    clip_id: Annotated[UUID | None, Form()] = None,
    frame_time_seconds: Annotated[float | None, Form(ge=0, allow_inf_nan=False)] = None,
) -> SavedFrameClassification:
    response.headers["Cache-Control"] = "no-store"
    try:
        selections = FRAME_SELECTION.validate_json(boxes)
    except ValidationError as error:
        raise HTTPException(
            422, f"Choose 1 to {MAX_SELECTED_BOXES} valid frame boxes."
        ) from error
    if len({item.id for item in selections}) != len(selections) or any(
        item.bbox.x + item.bbox.width > 1 + BOX_BOUNDARY_TOLERANCE
        or item.bbox.y + item.bbox.height > 1 + BOX_BOUNDARY_TOLERANCE
        or item.bbox.x >= 1
        or item.bbox.y >= 1
        for item in selections
    ):
        raise HTTPException(422, "Select unique boxes inside the captured frame.")
    with await read_image(image) as frame:
        try:
            result = await run_in_threadpool(classify_frame_crops, frame, selections)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            raise HTTPException(
                503,
                f"Place best.pt in classifier run {MODEL_ID} before classifying a frame.",
            ) from error
        except (ImportError, KeyError, OSError, RuntimeError, ValueError) as error:
            raise HTTPException(
                503,
                "Unable to classify the selected boxes. Check the ConvNeXt checkpoint.",
            ) from error

    resolved_review_id = review_id or uuid4()
    try:
        await run_in_threadpool(
            save_frame_classification,
            resolved_review_id,
            clip_id,
            frame_time_seconds,
            selections,
            result,
        )
    except (DatabaseNotConfiguredError, SQLAlchemyError) as error:
        raise HTTPException(
            503, "Unable to save the classification. Check the database and retry."
        ) from error
    return SavedFrameClassification(
        crops=result.crops, saved_review_id=resolved_review_id
    )


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
    if video.size is not None and not 0 < video.size <= MAX_OPERATOR_UPLOAD_BYTES:
        raise HTTPException(
            413, f"Video is empty or exceeds {MAX_OPERATOR_UPLOAD_MIB} MB."
        )
    if not VIDEO_LOCK.acquire(blocking=False):
        raise HTTPException(409, "A video is already being classified.")
    try:
        with TemporaryDirectory(prefix="parkmap-video-") as directory:
            path = Path(directory) / f"clip{suffix}"
            with path.open("wb") as output:
                total = 0
                while chunk := video.file.read(UPLOAD_READ_CHUNK_BYTES):
                    total += len(chunk)
                    if total > MAX_OPERATOR_UPLOAD_BYTES:
                        raise HTTPException(
                            413, f"Video exceeds {MAX_OPERATOR_UPLOAD_MIB} MB."
                        )
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
