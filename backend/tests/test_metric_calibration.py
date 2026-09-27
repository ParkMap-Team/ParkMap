import json
import math
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import MetricRowMeasurement
from app.services.metric_calibration_service import metric_calibration_service


class MetricCalibrationApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_directory = metric_calibration_service.config_directory
        self.original_path = metric_calibration_service.calibration_path
        metric_calibration_service.config_directory = Path(self.temporary_directory.name)
        metric_calibration_service.calibration_path = metric_calibration_service.config_directory / "metric_calibration.json"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        metric_calibration_service.config_directory = self.original_directory
        metric_calibration_service.calibration_path = self.original_path
        self.temporary_directory.cleanup()

    @staticmethod
    def payload(rows: list[dict] | None = None, source: str = "ESTIMATED") -> dict:
        return {
            "schema_version": 1,
            "camera_id": "SPU_CAM_01",
            "unit": "meter",
            "measurement_source": source,
            "rows": rows or [],
            "reference_segments": [],
            "ground_control_points": [],
        }

    def test_missing_file_is_not_calibrated_without_creating_a_file(self) -> None:
        response = self.client.get("/api/metric-calibration")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "NOT_CALIBRATED")
        self.assertIsNone(response.json()["calibration"])
        self.assertFalse(metric_calibration_service.calibration_path.exists())

    def test_partial_configuration_saves_and_loads(self) -> None:
        response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 12.5}]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "PARTIALLY_CALIBRATED")
        self.assertEqual(self.client.get("/api/metric-calibration").json(), response.json())

    def test_all_five_rows_complete_row_measurements(self) -> None:
        rows = [{"id": f"row_{index}", "length_m": float(index)} for index in range(1, 6)]
        response = self.client.post("/api/metric-calibration", json=self.payload(rows))
        self.assertEqual(response.json()["status"], "CALIBRATED")
        self.assertTrue(response.json()["row_measurements_complete"])
        self.assertFalse(response.json()["ground_plane_calibration_available"])

    def test_accepts_positive_finite_length(self) -> None:
        self.assertEqual(self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_2", "length_m": 0.01}])).status_code, 200)

    def test_rejects_zero_and_negative_lengths_through_api(self) -> None:
        for value in (0, -1):
            with self.subTest(value=value):
                response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": value}]))
                self.assertEqual(response.status_code, 422)

    def test_rejects_nan_and_infinity_at_the_validation_boundary(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MetricRowMeasurement(id="row_1", length_m=value)

    def test_rejects_unknown_and_duplicate_rows(self) -> None:
        unknown = self.payload([{"id": "row_6", "length_m": 1}])
        duplicate = self.payload([{"id": "row_1", "length_m": 1}, {"id": "row_1", "length_m": 2}])
        self.assertEqual(self.client.post("/api/metric-calibration", json=unknown).status_code, 422)
        self.assertEqual(self.client.post("/api/metric-calibration", json=duplicate).status_code, 422)

    def test_rejects_unsupported_unit_and_malformed_coordinates(self) -> None:
        unsupported = self.payload()
        unsupported["unit"] = "centimeter"
        malformed = self.payload()
        malformed["ground_control_points"] = [{"id": "g1", "image": {"x": 2, "y": 0.5}, "ground": {"x_m": 0, "y_m": 0}}]
        self.assertEqual(self.client.post("/api/metric-calibration", json=unsupported).status_code, 422)
        self.assertEqual(self.client.post("/api/metric-calibration", json=malformed).status_code, 422)

    def test_no_fake_ground_points_are_created(self) -> None:
        response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 5}]))
        self.assertEqual(response.json()["calibration"]["ground_control_points"], [])

    def test_saving_metric_data_does_not_modify_parking_calibration(self) -> None:
        parking_path = metric_calibration_service.config_directory / "parking_calibration.json"
        original = b'{"preserve":"exactly"}\n'
        parking_path.write_bytes(original)
        response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 5}]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(parking_path.read_bytes(), original)

    def test_malformed_saved_file_fails_clearly(self) -> None:
        metric_calibration_service.calibration_path.write_text("{not-json", encoding="utf-8")
        response = self.client.get("/api/metric-calibration")
        self.assertEqual(response.status_code, 500)
        self.assertIn("could not be loaded", response.json()["detail"])

    def test_accepts_estimated_and_measured_sources(self) -> None:
        for source in ("ESTIMATED", "MEASURED"):
            with self.subTest(source=source):
                response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 5}], source))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["measurement_source"], source)

    def test_rejects_invalid_measurement_source(self) -> None:
        response = self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 5}], "GUESSED"))
        self.assertEqual(response.status_code, 422)

    def test_measurement_source_survives_save_and_load(self) -> None:
        for source in ("ESTIMATED", "MEASURED"):
            with self.subTest(source=source):
                self.client.post("/api/metric-calibration", json=self.payload([{"id": "row_1", "length_m": 5}], source))
                self.assertEqual(self.client.get("/api/metric-calibration").json()["measurement_source"], source)

    def test_complete_estimated_rows_do_not_enable_ground_plane(self) -> None:
        rows = [{"id": f"row_{index}", "length_m": float(index)} for index in range(1, 6)]
        response = self.client.post("/api/metric-calibration", json=self.payload(rows, "ESTIMATED"))
        self.assertEqual(response.json()["status"], "CALIBRATED")
        self.assertEqual(response.json()["measurement_source"], "ESTIMATED")
        self.assertFalse(response.json()["ground_plane_calibration_available"])

    def test_switching_to_measured_requires_explicit_post(self) -> None:
        rows = [{"id": "row_1", "length_m": 5}]
        estimated = self.client.post("/api/metric-calibration", json=self.payload(rows, "ESTIMATED")).json()
        self.assertEqual(estimated["measurement_source"], "ESTIMATED")
        self.assertEqual(self.client.get("/api/metric-calibration").json()["measurement_source"], "ESTIMATED")
        measured = self.client.post("/api/metric-calibration", json=self.payload(rows, "MEASURED")).json()
        self.assertEqual(measured["measurement_source"], "MEASURED")


if __name__ == "__main__":
    unittest.main()
