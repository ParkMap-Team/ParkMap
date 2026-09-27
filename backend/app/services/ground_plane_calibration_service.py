import json
import os
import tempfile
from pathlib import Path

from app.models import GroundPlaneCalibration, GroundPlaneCalibrationResponse


def _non_collinear(calibration: GroundPlaneCalibration) -> bool:
    points = calibration.control_points
    if len(points) < 4:
        return False
    for index, a in enumerate(points):
        for second in range(index + 1, len(points)):
            b = points[second]
            for third in range(second + 1, len(points)):
                c = points[third]
                ground_area = (b.ground_x_m - a.ground_x_m) * (c.ground_y_m - a.ground_y_m) - (b.ground_y_m - a.ground_y_m) * (c.ground_x_m - a.ground_x_m)
                image_area = (b.image_x - a.image_x) * (c.image_y - a.image_y) - (b.image_y - a.image_y) * (c.image_x - a.image_x)
                if abs(ground_area) > 1e-9 and abs(image_area) > 1e-9:
                    return True
    return False


class GroundPlaneCalibrationService:
    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.calibration_path = self.config_directory / "ground_plane_calibration.json"

    def load(self) -> GroundPlaneCalibration:
        with self.calibration_path.open("r", encoding="utf-8") as file:
            return GroundPlaneCalibration.model_validate(json.load(file))

    @staticmethod
    def response(calibration: GroundPlaneCalibration) -> GroundPlaneCalibrationResponse:
        measured = sum(point.provenance == "MEASURED" for point in calibration.control_points)
        ready = len(calibration.control_points) >= 4 and measured >= 4 and _non_collinear(calibration)
        return GroundPlaneCalibrationResponse(status="READY_FOR_HOMOGRAPHY" if ready else "NOT_READY", control_point_count=len(calibration.control_points), measured_point_count=measured, calibration=calibration)

    def save(self, calibration: GroundPlaneCalibration) -> GroundPlaneCalibrationResponse:
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.config_directory, prefix="ground_plane_calibration.", suffix=".tmp", delete=False) as file:
                temporary_path = Path(file.name)
                json.dump(calibration.model_dump(mode="json"), file, indent=2)
                file.write("\n"); file.flush(); os.fsync(file.fileno())
            os.replace(temporary_path, self.calibration_path)
        finally:
            if temporary_path is not None and temporary_path.exists(): temporary_path.unlink()
        persisted = self.load()
        if persisted.model_dump(mode="json") != calibration.model_dump(mode="json"):
            raise OSError("Ground-plane calibration read-after-write verification failed.")
        return self.response(persisted)


ground_plane_calibration_service = GroundPlaneCalibrationService()
