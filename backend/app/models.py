from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

SystemStatus = Literal["loading", "online", "offline", "error", "stale", "processing"]
ModelStatus = Literal["ready", "processing", "offline", "error"]


class ParkingObject(BaseModel):
    id: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)
    rotation: float | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    row_id: str | None = None


class CameraStatus(BaseModel):
    id: str
    name: str
    status: SystemStatus
    frame_url: str | None = None
    last_frame_at: datetime | None = None


class DetectionModelStatus(BaseModel):
    name: str
    status: ModelStatus


class ParkingSummary(BaseModel):
    motorcycles: int = Field(ge=0)
    available: int = Field(ge=0)
    occupied: int = Field(ge=0)
    uncertain: int = Field(ge=0)


class ParkingStatusResponse(BaseModel):
    camera_id: str
    zone_id: str
    timestamp: datetime
    system_status: SystemStatus
    data_source: Literal["test"] = "test"
    camera: CameraStatus
    model: DetectionModelStatus
    summary: ParkingSummary
    occupied: list[ParkingObject]
    available: list[ParkingObject]
    uncertain: list[ParkingObject]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class DetectionBBox(BaseModel):
    """Normalized top-left box: x=left, y=top; never center coordinates."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)


class Detection(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: DetectionBBox


class DetectionAnalysisModel(BaseModel):
    name: str
    status: Literal["ready"] = "ready"


class DetectionInference(BaseModel):
    imgsz: int = Field(gt=0)
    confidence_threshold: float = Field(ge=0.0, le=1.0)
    nms_iou: float = Field(ge=0.0, le=1.0)
    processing_time_ms: float = Field(ge=0.0)


class DetectionResponse(BaseModel):
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    model: DetectionAnalysisModel
    inference: DetectionInference
    detections: list[Detection]


class CalibrationPoint(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class CalibrationPolygon(BaseModel):
    polygon: list[CalibrationPoint] = Field(min_length=3)


class CalibrationRow(CalibrationPolygon):
    id: str
    name: str


class CalibrationReferenceImage(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ParkingCalibration(BaseModel):
    schema_version: Literal[2] = 2
    camera_id: str = Field(min_length=1)
    reference_image: CalibrationReferenceImage
    parking_roi: CalibrationPolygon
    rows: list[CalibrationRow] = Field(min_length=5, max_length=5)

    @model_validator(mode="after")
    def validate_rows(self) -> "ParkingCalibration":
        expected = [f"row_{index}" for index in range(1, 6)]
        actual = [row.id for row in self.rows]
        if actual != expected:
            raise ValueError("Calibration rows must be exactly row_1 through row_5 in order.")
        expected_names = [f"Parking Row {index}" for index in range(1, 6)]
        if [row.name for row in self.rows] != expected_names:
            raise ValueError("Calibration row names must be Parking Row 1 through Parking Row 5 in order.")
        return self
