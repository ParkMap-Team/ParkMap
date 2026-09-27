from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

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
    status: Literal["stub"] = "stub"


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
