import json
import os
import tempfile
from pathlib import Path

from app.models import MetricCalibration, MetricCalibrationResponse


class MetricCalibrationService:
    """Persists user-supplied physical measurements separately from image geometry."""

    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.calibration_path = self.config_directory / "metric_calibration.json"

    def load(self) -> MetricCalibration | None:
        if not self.calibration_path.is_file():
            return None
        with self.calibration_path.open("r", encoding="utf-8") as calibration_file:
            return MetricCalibration.model_validate(json.load(calibration_file))

    @staticmethod
    def response(calibration: MetricCalibration | None) -> MetricCalibrationResponse:
        measured_rows = len(calibration.rows) if calibration else 0
        has_measurements = bool(calibration and (calibration.rows or calibration.reference_segments or calibration.ground_control_points))
        status = "CALIBRATED" if measured_rows == 5 else "PARTIALLY_CALIBRATED" if has_measurements else "NOT_CALIBRATED"
        return MetricCalibrationResponse(
            status=status,
            measurement_source=calibration.measurement_source if calibration else "ESTIMATED",
            row_measurements_complete=measured_rows == 5,
            ground_plane_calibration_available=False,
            calibration=calibration,
        )

    def get_response(self) -> MetricCalibrationResponse:
        return self.response(self.load())

    def save(self, calibration: MetricCalibration) -> MetricCalibrationResponse:
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.config_directory,
                prefix="metric_calibration.", suffix=".tmp", delete=False,
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
        return self.response(calibration)


metric_calibration_service = MetricCalibrationService()
