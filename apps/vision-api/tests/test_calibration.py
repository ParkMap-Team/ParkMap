import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.calibration_service import calibration_service


class CalibrationApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_directory = calibration_service.config_directory
        self.original_path = calibration_service.calibration_path
        calibration_service.config_directory = Path(self.temporary_directory.name)
        calibration_service.calibration_path = calibration_service.config_directory / "parking_calibration.json"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        calibration_service.config_directory = self.original_directory
        calibration_service.calibration_path = self.original_path
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
        incomplete["rows"] = []
        self.assertEqual(self.client.post("/api/calibration", json=incomplete).status_code, 422)

        pixel_coordinates = self.valid_payload()
        pixel_coordinates["parking_roi"]["polygon"][0]["x"] = 512
        self.assertEqual(self.client.post("/api/calibration", json=pixel_coordinates).status_code, 422)

    def test_accepts_dynamic_row_counts_and_rejects_duplicate_ids(self) -> None:
        for count in (1, 3, 5, 8):
            payload = self.valid_payload()
            payload["rows"] = [{"id": f"row_{index}", "name": f"Parking Row {index}", "polygon": payload["parking_roi"]["polygon"]} for index in range(1, count + 1)]
            response = self.client.post("/api/calibration", json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()["rows"]), count)
        duplicate = self.valid_payload()
        duplicate["rows"][1]["id"] = "row_1"
        self.assertEqual(self.client.post("/api/calibration", json=duplicate).status_code, 422)

    def test_sparse_row_ids_remain_stable(self) -> None:
        payload = self.valid_payload()
        payload["rows"] = [payload["rows"][0], payload["rows"][2], payload["rows"][4], {**payload["rows"][0], "id": "row_6", "name": "Parking Row 6"}]
        response = self.client.post("/api/calibration", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()["rows"]], ["row_1", "row_3", "row_5", "row_6"])


if __name__ == "__main__":
    unittest.main()
