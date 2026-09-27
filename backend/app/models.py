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


MetricCalibrationStatus = Literal["NOT_CALIBRATED", "PARTIALLY_CALIBRATED", "CALIBRATED"]
MetricMeasurementSource = Literal["ESTIMATED", "MEASURED"]
MetricRowId = Literal["row_1", "row_2", "row_3", "row_4", "row_5"]


class MetricRowMeasurement(BaseModel):
    id: MetricRowId
    length_m: float = Field(gt=0.0, allow_inf_nan=False)


class MetricReferenceSegment(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    distance_m: float = Field(gt=0.0, allow_inf_nan=False)
    image_start: CalibrationPoint
    image_end: CalibrationPoint


class MetricGroundPoint(BaseModel):
    x_m: float = Field(allow_inf_nan=False)
    y_m: float = Field(allow_inf_nan=False)


class MetricGroundControlPoint(BaseModel):
    id: str = Field(min_length=1)
    image: CalibrationPoint
    ground: MetricGroundPoint


class MetricCalibration(BaseModel):
    schema_version: Literal[1] = 1
    camera_id: str = Field(min_length=1)
    unit: Literal["meter"] = "meter"
    measurement_source: MetricMeasurementSource = "ESTIMATED"
    rows: list[MetricRowMeasurement] = Field(default_factory=list, max_length=5)
    reference_segments: list[MetricReferenceSegment] = Field(default_factory=list)
    ground_control_points: list[MetricGroundControlPoint] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "MetricCalibration":
        for collection, label in (
            (self.rows, "row"),
            (self.reference_segments, "reference segment"),
            (self.ground_control_points, "ground control point"),
        ):
            ids = [item.id for item in collection]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {label} IDs are not allowed.")
        return self


class MetricCalibrationResponse(BaseModel):
    status: MetricCalibrationStatus
    measurement_source: MetricMeasurementSource
    row_measurements_complete: bool
    ground_plane_calibration_available: Literal[False] = False
    calibration: MetricCalibration | None


class MotorcycleFittingConfiguration(BaseModel):
    schema_version: Literal[1] = 1
    measurement_source: MetricMeasurementSource = "ESTIMATED"
    required_space_m: float = Field(gt=0.0, allow_inf_nan=False)


class MotorcycleFittingResponse(BaseModel):
    configured: bool
    configuration: MotorcycleFittingConfiguration | None
