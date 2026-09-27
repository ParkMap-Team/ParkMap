from pathlib import Path


class CalibrationService:
    """Locates future ROI, homography, and calibrated-row configuration."""

    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"

    @property
    def is_configured(self) -> bool:
        return (self.config_directory / "parking_roi.json").exists()


calibration_service = CalibrationService()
