"""Local Seg inference; operator consumers use boxes and image masks separately."""

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

from app.models import Detection, DetectionBBox, DetectionResponse
from app.parking_inference_settings import (
    SEGMENTATION_MOTORCYCLE_CLASS_ID,
    SEGMENTATION_WEIGHTS,
)
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


# ParkMap YOLO26n Seg Round 8, shared by Calibration and the frame worker.
SEGMENTATION_WEIGHTS_SHA256 = "9f835c67849593cafc423414161d44b8377deaf221348b4929213544715ca1af"


def segmentation_model_path() -> Path:
    configured = Path(os.getenv("PARKMAP_SEGMENTATION_MODEL_PATH", str(SEGMENTATION_WEIGHTS)))
    return configured if configured.is_absolute() else Path(__file__).resolve().parents[2] / configured


class SegmentationExperimentService:
    def __init__(self, model_path: Path | None = None, class_id: int | None = None):
        self.model_path = model_path if model_path is not None else segmentation_model_path()
        self.imgsz = int(os.getenv("PARKMAP_SEGMENTATION_IMGSZ", os.getenv("PARKMAP_MODEL_IMGSZ", "960")))
        self.confidence = float(os.getenv("PARKMAP_MODEL_CONF", ".25"))
        self.iou = float(os.getenv("PARKMAP_MODEL_NMS_IOU", ".50"))
        self.device = os.getenv("PARKMAP_DEVICE", "cpu")
        self.class_id = class_id if class_id is not None else int(os.getenv("PARKMAP_SEGMENTATION_CLASS_ID", str(SEGMENTATION_MOTORCYCLE_CLASS_ID)))
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
        try:
            return self.analyze_frame(decoded)
        finally:
            decoded.close()

    def analyze_frame(self, decoded: Image.Image, *, imgsz: int | None = None) -> SegmentationExperimentResult:
        width, height = decoded.size
        effective_imgsz = self.imgsz if imgsz is None else imgsz
        started = perf_counter()
        with self._lock:
            results = self._load_model().predict(source=decoded, imgsz=effective_imgsz, conf=self.confidence,
                iou=self.iou, device=self.device, classes=[self.class_id], verbose=False)
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
            processing_time_ms=processing_time_ms, imgsz=effective_imgsz, detections=detections)

    def detection_response(self, result: SegmentationExperimentResult) -> DetectionResponse:
        return DetectionResponse(
            image_width=result.image_width, image_height=result.image_height,
            model={"name": result.model}, inference={"imgsz": result.imgsz,
                "confidence_threshold": self.confidence, "nms_iou": self.iou, "processing_time_ms": result.processing_time_ms},
            detections=[Detection(class_id=self.class_id, class_name="motorcycle", confidence=item.confidence, bbox=item.bbox)
                        for item in result.detections],
        )


segmentation_experiment_service = SegmentationExperimentService()
parking_segmentation_service = SegmentationExperimentService(
    SEGMENTATION_WEIGHTS, class_id=SEGMENTATION_MOTORCYCLE_CLASS_ID,
)
