import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.calibration_service import calibration_service


class CalibrationApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        calibration_service.config_directory = Path(self.temporary_directory.name)
        calibration_service.calibration_path = calibration_service.config_directory / "parking_calibration.json"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    @staticmethod
    def valid_payload() -> dict:
        polygon = [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.5, "y": 0.9}]
        return {
            "schema_version": 2,
            "camera_id": "SPU_CAM_01",
            "reference_image": {"width": 4032, "height": 3024},
            "parking_roi": {"polygon": polygon},
            "rows": [
                {"id": f"row_{index}", "name": f"Parking Row {index}", "polygon": polygon}
                for index in range(1, 6)
            ],
        }

    def test_not_configured_then_save_and_restore(self) -> None:
        self.assertEqual(self.client.get("/api/calibration").status_code, 404)

        response = self.client.post("/api/calibration", json=self.valid_payload())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(calibration_service.calibration_path.is_file())
        self.assertNotIn("detections", response.json())

        restored = self.client.get("/api/calibration")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json(), response.json())

    def test_rejects_incomplete_and_pixel_coordinate_payloads(self) -> None:
        incomplete = self.valid_payload()
        incomplete["rows"] = incomplete["rows"][:4]
        self.assertEqual(self.client.post("/api/calibration", json=incomplete).status_code, 422)

        pixel_coordinates = self.valid_payload()
        pixel_coordinates["parking_roi"]["polygon"][0]["x"] = 512
        self.assertEqual(self.client.post("/api/calibration", json=pixel_coordinates).status_code, 422)


if __name__ == "__main__":
    unittest.main()
