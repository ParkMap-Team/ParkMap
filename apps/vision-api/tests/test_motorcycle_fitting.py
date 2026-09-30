import math
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import MotorcycleFittingConfiguration
from app.services.motorcycle_fitting_service import motorcycle_fitting_service


class MotorcycleFittingApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_directory = motorcycle_fitting_service.config_directory
        self.original_path = motorcycle_fitting_service.config_path
        motorcycle_fitting_service.config_directory = Path(self.temporary_directory.name)
        motorcycle_fitting_service.config_path = motorcycle_fitting_service.config_directory / "motorcycle_fitting.json"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        motorcycle_fitting_service.config_directory = self.original_directory
        motorcycle_fitting_service.config_path = self.original_path
        self.temporary_directory.cleanup()

    def test_missing_config_returns_unconfigured_without_creating_file(self) -> None:
        response = self.client.get("/api/motorcycle-fitting")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"configured": False, "configuration": None})
        self.assertFalse(motorcycle_fitting_service.config_path.exists())

    def test_configuration_save_and_load(self) -> None:
        payload = {"schema_version": 1, "measurement_source": "ESTIMATED", "required_space_m": 1.8}
        response = self.client.post("/api/motorcycle-fitting", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/motorcycle-fitting").json(), response.json())

    def test_measured_provenance_survives_save(self) -> None:
        payload = {"schema_version": 1, "measurement_source": "MEASURED", "required_space_m": 2.0}
        self.assertEqual(self.client.post("/api/motorcycle-fitting", json=payload).json()["configuration"]["measurement_source"], "MEASURED")

    def test_rejects_zero_and_negative_requirement(self) -> None:
        for value in (0, -1):
            with self.subTest(value=value):
                self.assertEqual(self.client.post("/api/motorcycle-fitting", json={"schema_version": 1, "measurement_source": "ESTIMATED", "required_space_m": value}).status_code, 422)

    def test_rejects_nan_and_infinity(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MotorcycleFittingConfiguration(required_space_m=value)

    def test_rejects_invalid_measurement_source(self) -> None:
        response = self.client.post("/api/motorcycle-fitting", json={"schema_version": 1, "measurement_source": "GUESSED", "required_space_m": 1})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
