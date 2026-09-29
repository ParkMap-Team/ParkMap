import json
import os
import tempfile
from pathlib import Path

from app.models import ParkingCalibration


class CalibrationService:
    """Persists a normalized parking ROI and a dynamic collection of rows."""

    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.calibration_path = self.config_directory / "parking_calibration.json"

    @property
    def is_configured(self) -> bool:
        return self.calibration_path.is_file()

    def load(self) -> ParkingCalibration | None:
        if not self.is_configured:
            return None
        with self.calibration_path.open("r", encoding="utf-8") as calibration_file:
            return ParkingCalibration.model_validate(json.load(calibration_file))

    def save(self, calibration: ParkingCalibration) -> ParkingCalibration:
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.config_directory,
                prefix="parking_calibration.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(calibration.model_dump(mode="json"), temporary_file, indent=2)
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self.calibration_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        return calibration


calibration_service = CalibrationService()
