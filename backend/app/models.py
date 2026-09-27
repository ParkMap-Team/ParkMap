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
