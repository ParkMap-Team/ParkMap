import json
import os
import tempfile
from pathlib import Path

from app.models import MotorcycleFittingConfiguration, MotorcycleFittingResponse


class MotorcycleFittingService:
    """Persists the explicit one-dimensional fitting requirement separately."""

    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.config_path = self.config_directory / "motorcycle_fitting.json"

    def load(self) -> MotorcycleFittingConfiguration | None:
        if not self.config_path.is_file():
            return None
        with self.config_path.open("r", encoding="utf-8") as config_file:
            return MotorcycleFittingConfiguration.model_validate(json.load(config_file))

    def get_response(self) -> MotorcycleFittingResponse:
        configuration = self.load()
        return MotorcycleFittingResponse(configured=configuration is not None, configuration=configuration)

    def save(self, configuration: MotorcycleFittingConfiguration) -> MotorcycleFittingResponse:
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.config_directory,
                prefix="motorcycle_fitting.", suffix=".tmp", delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(configuration.model_dump(mode="json"), temporary_file, indent=2)
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self.config_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        return MotorcycleFittingResponse(configured=True, configuration=configuration)


motorcycle_fitting_service = MotorcycleFittingService()
