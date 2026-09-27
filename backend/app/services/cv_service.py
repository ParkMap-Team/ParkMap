import hashlib
import os

from app.models import (
    Detection,
    DetectionAnalysisModel,
    DetectionBBox,
    DetectionInference,
    DetectionResponse,
)


class ComputerVisionService:
    """Deterministic detection stub and future boundary for Ultralytics YOLO."""

    def __init__(self) -> None:
        self.model_path = os.getenv("PARKMAP_MODEL_PATH", "models/best.pt")
        self.imgsz = int(os.getenv("PARKMAP_MODEL_IMGSZ", "1280"))
        self.confidence_threshold = float(os.getenv("PARKMAP_MODEL_CONF", "0.25"))
        self.nms_iou = float(os.getenv("PARKMAP_MODEL_NMS_IOU", "0.50"))
        self.device = os.getenv("PARKMAP_DEVICE", "cpu")

    @property
    def is_configured(self) -> bool:
        # A configured path does not mean real weights are installed or loaded.
        return False

    def analyze_image(self, image_bytes: bytes, image_width: int, image_height: int) -> DetectionResponse:
        """Return stable stub detections for the same image bytes.

        Future YOLO xyxy output must be converted to normalized top-left form:
        x=x1/image_width, y=y1/image_height,
        width=(x2-x1)/image_width, height=(y2-y1)/image_height.
        """
        digest = hashlib.sha256(image_bytes).digest()
        offset_x = (digest[0] % 5) / 500
        offset_y = (digest[1] % 5) / 500
        boxes = [
            (0.18 + offset_x, 0.24 + offset_y, 0.075, 0.19, 0.91),
            (0.36 + offset_x, 0.20 + offset_y, 0.07, 0.21, 0.88),
            (0.55 + offset_x, 0.52 + offset_y, 0.08, 0.22, 0.94),
            (0.76 + offset_x, 0.48 + offset_y, 0.072, 0.20, 0.86),
        ]
        detections = [
            Detection(
                class_id=0,
                class_name="motorcycle",
                confidence=confidence,
                bbox=DetectionBBox(x=x, y=y, width=width, height=height),
            )
            for x, y, width, height, confidence in boxes
        ]
        return DetectionResponse(
            image_width=image_width,
            image_height=image_height,
            model=DetectionAnalysisModel(name="ParkMap Detection Stub"),
            inference=DetectionInference(
                imgsz=self.imgsz,
                confidence_threshold=self.confidence_threshold,
                nms_iou=self.nms_iou,
                processing_time_ms=12.5,
            ),
            detections=detections,
        )


cv_service = ComputerVisionService()
