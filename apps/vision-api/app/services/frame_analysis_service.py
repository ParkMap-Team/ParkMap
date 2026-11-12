from datetime import UTC, datetime
from pathlib import Path

import cv2
from pydantic import ValidationError

from app.models import (
    Detection,
    DetectionResponse,
    ParkingCalibration,
    ParkingStatePublish,
    StateSourceKind,
)
from app.services.live_state_service import (
    CalibrationFilesUnavailableError,
    build_segmentation_state_publish,
    calibration_identity,
)
from app.services.segmentation_experiment_service import segmentation_experiment_service
from app.services.segmentation_gap_service import analyze_segmentation_gaps

CONFIG_DIRECTORY = Path(__file__).resolve().parents[2] / "config"


def analyze_segmentation_frame(image, captured_at: datetime, *, parking_area_id: str, source: StateSourceKind) -> ParkingStatePublish:
    version, provenance = calibration_identity(CONFIG_DIRECTORY)
    encoded, jpeg = cv2.imencode(".jpg", image)
    if not encoded:
        raise ValueError("Frame could not be encoded.")
    segmented = segmentation_experiment_service.analyze_image(jpeg.tobytes())
    detection = DetectionResponse(image_width=segmented.image_width, image_height=segmented.image_height,
        model={"name": segmented.model}, inference={"imgsz": segmented.imgsz,
            "confidence_threshold": segmentation_experiment_service.confidence,
            "nms_iou": segmentation_experiment_service.iou, "processing_time_ms": segmented.processing_time_ms},
        detections=[Detection(class_id=segmentation_experiment_service.class_id, class_name="motorcycle",
            confidence=item.confidence, bbox=item.bbox) for item in segmented.detections])
    gaps = analyze_segmentation_gaps(detection, segmented, visible_free_shapes=False,
        bottom_edge_assignment=True, image_row_assignment=True)
    try:
        camera = ParkingCalibration.model_validate_json((CONFIG_DIRECTORY / "parking_calibration.json").read_bytes()).camera_id
    except (OSError, ValidationError) as error:
        raise CalibrationFilesUnavailableError("Parking calibration is unavailable or invalid") from error
    if calibration_identity(CONFIG_DIRECTORY) != (version, provenance):
        raise CalibrationFilesUnavailableError("Calibration changed during worker analysis")
    return build_segmentation_state_publish(
        segmented, gaps,
        camera_id=camera,
        parking_area_id=parking_area_id,
        source=source,
        observed_at=captured_at,
        processed_at=datetime.now(UTC),
        calibration_version=version,
        calibration_provenance=provenance,
    )
