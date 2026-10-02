import logging
import os
from io import BytesIO
from pathlib import Path
from threading import Lock
from time import perf_counter

from dotenv import load_dotenv
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

from app.models import Detection, DetectionAnalysisModel, DetectionBBox, DetectionInference, DetectionResponse
from app.services.model_version import analysis_version_for_model

logger = logging.getLogger(__name__)


class ModelUnavailableError(RuntimeError):
    """The configured inference model cannot serve requests."""


class ComputerVisionService:
    """Loads ParkMap's YOLO model once and performs motorcycle detection."""

    def __init__(self) -> None:
        backend_root = Path(__file__).resolve().parents[2]
        load_dotenv(backend_root / ".env")
        configured_path = Path(os.getenv("PARKMAP_MODEL_PATH", "models/best.pt"))
        self.model_path = configured_path if configured_path.is_absolute() else backend_root / configured_path
        self.imgsz = int(os.getenv("PARKMAP_MODEL_IMGSZ", "960"))
        self.confidence_threshold = float(os.getenv("PARKMAP_MODEL_CONF", "0.25"))
        self.nms_iou = float(os.getenv("PARKMAP_MODEL_NMS_IOU", "0.50"))
        self.device = os.getenv("PARKMAP_DEVICE", "cpu")

        self._model: YOLO | None = None
        self._model_lock = Lock()
        self._published_versions: dict[str, str] = {}

    @property
    def is_configured(self) -> bool:
        return self.model_path.is_file()

    def _load_model(self) -> YOLO:
        if self._model is not None:
            return self._model
        if not self.model_path.is_file():
            logger.error("ParkMap YOLO model file was not found: %s", self.model_path)
            raise ModelUnavailableError("The detection model is unavailable.")
        try:
            self._model = YOLO(str(self.model_path), task="detect")
        except Exception as exc:
            logger.exception("ParkMap YOLO model could not be loaded from %s", self.model_path)
            raise ModelUnavailableError("The detection model is unavailable.") from exc
        logger.info("ParkMap YOLO model loaded from %s", self.model_path)
        return self._model

    def published_analysis_version(self, analysis_revision: str) -> str:
        """Identify the loaded worker model and settings in a published state."""
        with self._model_lock:
            if self._model is None:
                raise ModelUnavailableError("The detection model is unavailable.")
            if analysis_revision not in self._published_versions:
                try:
                    self._published_versions[analysis_revision] = analysis_version_for_model(
                        analysis_revision,
                        self.model_path,
                        imgsz=self.imgsz,
                        confidence=self.confidence_threshold,
                        nms_iou=self.nms_iou,
                        device=self.device,
                    )
                except (OSError, ValueError) as exc:
                    raise ModelUnavailableError("The detection model version is unavailable.") from exc
            return self._published_versions[analysis_revision]

    def analyze_image(self, image_bytes: bytes) -> DetectionResponse:
        """Decode an image, run YOLO, and return normalized top-left boxes."""
        try:
            with Image.open(BytesIO(image_bytes)) as uploaded_image:
                decoded_image = uploaded_image.convert("RGB")
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise ValueError("The uploaded file is not a valid supported image.") from exc

        image_width, image_height = decoded_image.size
        if image_width <= 0 or image_height <= 0:
            decoded_image.close()
            raise ValueError("The uploaded image has invalid dimensions.")

        started_at = perf_counter()
        try:
            with self._model_lock:
                results = self._load_model().predict(
                    source=decoded_image,
                    imgsz=self.imgsz,
                    conf=self.confidence_threshold,
                    iou=self.nms_iou,
                    device=self.device,
                    classes=[0],
                    verbose=False,
                )
        finally:
            decoded_image.close()
        processing_time_ms = (perf_counter() - started_at) * 1000

        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            xyxy_values = boxes.xyxy.detach().cpu().tolist()
            confidence_values = boxes.conf.detach().cpu().tolist()
            class_values = boxes.cls.detach().cpu().tolist()
            for xyxy, confidence, class_id_value in zip(xyxy_values, confidence_values, class_values):
                if int(class_id_value) != 0:
                    continue
                x1, y1, x2, y2 = (float(value) for value in xyxy)
                left = min(max(x1 / image_width, 0.0), 1.0)
                top = min(max(y1 / image_height, 0.0), 1.0)
                right = min(max(x2 / image_width, 0.0), 1.0)
                bottom = min(max(y2 / image_height, 0.0), 1.0)
                width = right - left
                height = bottom - top
                if width <= 0.0 or height <= 0.0:
                    continue
                detections.append(
                    Detection(
                        class_id=0,
                        class_name="motorcycle",
                        confidence=min(max(float(confidence), 0.0), 1.0),
                        bbox=DetectionBBox(x=left, y=top, width=width, height=height),
                    )
                )

        return DetectionResponse(
            image_width=image_width,
            image_height=image_height,
            model=DetectionAnalysisModel(name="ParkMap YOLO", status="ready"),
            inference=DetectionInference(
                imgsz=self.imgsz,
                confidence_threshold=self.confidence_threshold,
                nms_iou=self.nms_iou,
                processing_time_ms=processing_time_ms,
            ),
            detections=detections,
        )


cv_service = ComputerVisionService()
