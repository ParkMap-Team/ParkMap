"""Local image-mask comparison; never feeds parking geometry or live state."""

import math
import os
from io import BytesIO
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Literal

from PIL import Image
from pydantic import BaseModel, Field
from ultralytics import YOLO

from app.models import DetectionBBox
from app.services.cv_service import ModelUnavailableError


class MaskPoint(BaseModel):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)


class SegmentedMotorcycle(BaseModel):
    bbox: DetectionBBox
    confidence: float = Field(ge=0, le=1)
    polygon: list[MaskPoint] | None = None


class SegmentationExperimentResult(BaseModel):
    status: Literal["EXPERIMENTAL_IMAGE_MASK"] = "EXPERIMENTAL_IMAGE_MASK"
    model: str
    image_width: int
    image_height: int
    processing_time_ms: float
    imgsz: int
    detections: list[SegmentedMotorcycle]
    preview_url: str | None = None


def mask_polygon(masks, index):
    if masks is None or index >= len(masks):
        return None
    points = masks[index]
    if len(points) < 3:
        return None
    polygon = []
    for x, y in points:
        if not math.isfinite(float(x)) or not math.isfinite(float(y)):
            return None
        polygon.append(MaskPoint(x=min(1., max(0., float(x))), y=min(1., max(0., float(y)))))
    area = abs(sum(a.x * b.y - b.x * a.y for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True))) / 2
    return polygon if area > 1e-12 else None


class SegmentationExperimentService:
    def __init__(self):
        root = Path(__file__).resolve().parents[2]
        configured = Path(os.getenv("PARKMAP_SEGMENTATION_MODEL_PATH", "models/yolo11m-seg.pt"))
        self.model_path = configured if configured.is_absolute() else root / configured
        self.imgsz = int(os.getenv("PARKMAP_SEGMENTATION_IMGSZ", os.getenv("PARKMAP_MODEL_IMGSZ", "960")))
        self.confidence = float(os.getenv("PARKMAP_MODEL_CONF", ".25"))
        self.iou = float(os.getenv("PARKMAP_MODEL_NMS_IOU", ".50"))
        self.device = os.getenv("PARKMAP_DEVICE", "cpu")
        self.class_id = int(os.getenv("PARKMAP_SEGMENTATION_CLASS_ID", "3"))
        self._model = None
        self._lock = Lock()

    def _load_model(self):
        if self._model is not None:
            return self._model
        if not self.model_path.is_file():
            raise ModelUnavailableError("Local segmentation weights are missing.")
        try:
            model = YOLO(str(self.model_path), task="segment")
            if model.task != "segment" or str(model.names.get(self.class_id, "")).strip().lower() != "motorcycle":
                raise ValueError("Expected segmentation weights with the configured motorcycle class")
        except Exception as error:
            raise ModelUnavailableError("Local segmentation model is unavailable.") from error
        self._model = model
        return model

    def analyze_image(self, raw: bytes) -> SegmentationExperimentResult:
        with Image.open(BytesIO(raw)) as source:
            decoded = source.convert("RGB")
        width, height = decoded.size
        started = perf_counter()
        try:
            with self._lock:
                results = self._load_model().predict(source=decoded, imgsz=self.imgsz, conf=self.confidence,
                    iou=self.iou, device=self.device, classes=[self.class_id], verbose=False)
        finally:
            decoded.close()
        processing_time_ms = (perf_counter() - started) * 1000
        detections = []
        for result in results:
            if result.boxes is None:
                continue
            masks = result.masks.xyn if result.masks is not None else None
            boxes = result.boxes.xyxy.detach().cpu().tolist()
            scores = result.boxes.conf.detach().cpu().tolist()
            classes = result.boxes.cls.detach().cpu().tolist()
            for index, (box, score, class_id) in enumerate(zip(boxes, scores, classes, strict=True)):
                if int(class_id) != self.class_id:
                    continue
                x1, y1, x2, y2 = box
                left, top = min(1., max(0., x1 / width)), min(1., max(0., y1 / height))
                right, bottom = min(1., max(0., x2 / width)), min(1., max(0., y2 / height))
                if right <= left or bottom <= top:
                    continue
                detections.append(SegmentedMotorcycle(bbox=DetectionBBox(x=left, y=top, width=right-left, height=bottom-top),
                    confidence=score, polygon=mask_polygon(masks, index)))
        return SegmentationExperimentResult(model=self.model_path.name, image_width=width, image_height=height,
            processing_time_ms=processing_time_ms, imgsz=self.imgsz, detections=detections)


segmentation_experiment_service = SegmentationExperimentService()
