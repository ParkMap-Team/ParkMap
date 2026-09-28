import tempfile
import unittest
from pathlib import Path

from app.models import GroundPlaneCalibration, GroundPlaneHomographyResponse, GroundPlaneHomographyResult, ParkingCalibration, PhysicalRowGeometryConfig
from app.services.physical_row_geometry_service import PhysicalRowGeometryService, measurement_fingerprint, nearest_polygon_boundary
from datetime import datetime, timezone


class Point:
    def __init__(self, x, y): self.x, self.y = x, y


class PhysicalRowGeometryTest(unittest.TestCase):
    @staticmethod
    def inputs():
        measured_rows = {f"row_{index}": {"length_m": 15 if index <= 3 else 18, "width_m": 2, "provenance": "MEASURED"} for index in range(1, 6)}
        ground = GroundPlaneCalibration.model_validate({"schema_version": 1, "camera_id": "CAM", "reference_image": {"width": 1000, "height": 800}, "coordinate_system": {"unit": "meter"}, "control_points": [], "reference_distances": [], "measured_rows": measured_rows})
        polygon = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .2}, {"x": .1, "y": .2}]
        parking = ParkingCalibration.model_validate({"schema_version": 2, "camera_id": "CAM", "reference_image": {"width": 1000, "height": 800}, "parking_roi": {"polygon": polygon}, "rows": [{"id": f"row_{index}", "name": f"Parking Row {index}", "polygon": polygon} for index in range(1, 6)]})
        result = GroundPlaneHomographyResult.model_validate({"schema_version": 1, "camera_id": "CAM", "source_calibration_fingerprint": "x", "row_measurements_fingerprint": "y", "matrix": [[20, 0, 0], [0, 20, 0], [0, 0, 1]], "inverse_matrix": [[.05, 0, 0], [0, .05, 0], [0, 0, 1]], "control_point_count": 5, "inlier_count": 5, "rmse_m": 0, "mean_error_m": 0, "median_error_m": 0, "max_error_m": 0, "warning_rmse_m": .5, "warning_max_error_m": 1, "status": "VALIDATED", "calculated_at": datetime.now(timezone.utc), "point_diagnostics": []})
        homography = GroundPlaneHomographyResponse(status="VALIDATED", current=True, row_validation_current=True, message="ok", result=result)
        return ground, parking, homography

    def test_nearest_boundary_does_not_snap_implicitly(self):
        polygon = [Point(0, 0), Point(1, 0), Point(1, 1), Point(0, 1)]
        distance, x, y = nearest_polygon_boundary(.4, .2, polygon)
        self.assertAlmostEqual(distance, .2)
        self.assertAlmostEqual(x, .4)
        self.assertAlmostEqual(y, 0)

    def test_endpoint_persistence_round_trip(self):
        config = PhysicalRowGeometryConfig.model_validate({"schema_version": 1, "camera_id": "CAM", "measurement_source_fingerprint": "abc", "rows": {"row_1": {"start": {"clicked_image": {"x": .1, "y": .2}, "effective_image": {"x": .1, "y": .2}, "snapped_to_roi_boundary": False}, "end": None}}})
        with tempfile.TemporaryDirectory() as directory:
            service = PhysicalRowGeometryService(Path(directory))
            saved = service.save(config)
            self.assertEqual(saved, config)
            self.assertEqual(service.load.__self__.config_path.name, "physical_row_geometry.json")

    def test_no_manual_endpoints_builds_all_physical_rows_from_existing_geometry(self):
        ground, parking, homography = self.inputs()
        config = PhysicalRowGeometryConfig(camera_id="CAM", measurement_source_fingerprint=measurement_fingerprint(ground), rows={})
        response = PhysicalRowGeometryService().response(config, ground, parking, homography)
        self.assertTrue(all(row["status"] == "PHYSICAL_READY" for row in response["rows"]))
        self.assertTrue(all(row["source"] == "DERIVED_FROM_EXISTING_ROW" for row in response["rows"]))
        self.assertEqual(response["rows"][0]["measured_length_m"], 15)
        self.assertEqual(response["rows"][4]["measured_length_m"], 18)

    def test_manual_endpoints_apply_only_when_override_is_enabled(self):
        ground, parking, homography = self.inputs()
        endpoint = {"clicked_image": {"x": .2, "y": .3}, "effective_image": {"x": .2, "y": .3}, "snapped_to_roi_boundary": False}
        pair = {"override_enabled": False, "start": endpoint, "end": {**endpoint, "clicked_image": {"x": .8, "y": .3}, "effective_image": {"x": .8, "y": .3}}}
        config = PhysicalRowGeometryConfig.model_validate({"camera_id": "CAM", "measurement_source_fingerprint": measurement_fingerprint(ground), "rows": {"row_1": pair}})
        service = PhysicalRowGeometryService()
        derived = service.response(config, ground, parking, homography)["rows"][0]
        self.assertEqual(derived["source"], "DERIVED_FROM_EXISTING_ROW")
        config.rows["row_1"].override_enabled = True
        overridden = service.response(config, ground, parking, homography)["rows"][0]
        self.assertEqual(overridden["source"], "MANUAL_OVERRIDE")
        self.assertNotEqual(derived["start_metric"], overridden["start_metric"])


if __name__ == "__main__": unittest.main()
