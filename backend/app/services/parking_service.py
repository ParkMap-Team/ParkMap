from datetime import datetime, timezone

from app.models import CameraStatus, DetectionModelStatus, ParkingObject, ParkingStatusResponse, ParkingSummary


class ParkingService:
    """Provides API-ready parking status; currently deterministic test data."""

    def get_status(self) -> ParkingStatusResponse:
        timestamp = datetime.now(timezone.utc)
        occupied = [
            ParkingObject(id="TEST-M001", x=0.16, y=0.23, width=0.048, height=0.15, rotation=-4, confidence=0.96),
            ParkingObject(id="TEST-M002", x=0.27, y=0.21, width=0.045, height=0.16, rotation=2, confidence=0.93),
            ParkingObject(id="TEST-M003", x=0.52, y=0.58, width=0.045, height=0.16, rotation=176, confidence=0.95),
            ParkingObject(id="TEST-M004", x=0.82, y=0.55, width=0.046, height=0.16, rotation=183, confidence=0.92),
        ]
        available = [
            ParkingObject(id="TEST-A001", x=0.37, y=0.22, width=0.052, height=0.16, rotation=1),
            ParkingObject(id="TEST-A002", x=0.65, y=0.19, width=0.054, height=0.17, rotation=-2),
            ParkingObject(id="TEST-A003", x=0.31, y=0.61, width=0.054, height=0.17, rotation=179),
        ]
        uncertain = [ParkingObject(id="TEST-U001", x=0.72, y=0.57, width=0.057, height=0.18, rotation=178, confidence=0.54)]
        return ParkingStatusResponse(
            camera_id="SPU_CAM_01", zone_id="zone_A", timestamp=timestamp, system_status="online",
            camera=CameraStatus(id="SPU_CAM_01", name="SPU Motorcycle Parking", status="online", last_frame_at=timestamp),
            model=DetectionModelStatus(name="YOLO11n-SPU", status="ready"),
            summary=ParkingSummary(motorcycles=len(occupied), occupied=len(occupied), available=len(available), uncertain=len(uncertain)),
            occupied=occupied, available=available, uncertain=uncertain,
        )


parking_service = ParkingService()
