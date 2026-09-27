import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.models import GroundPlaneCalibration, ParkingCalibration
from app.services.ground_plane_homography_service import GroundPlaneHomographyService, HomographyInputError, calculate_homography, source_fingerprint, transform_point


def calibration(points):
    return GroundPlaneCalibration.model_validate({"schema_version": 1, "camera_id": "CAM", "reference_image": {"width": 1000, "height": 800}, "coordinate_system": {"unit": "meter", "description": "test"}, "control_points": [{"id": f"P{i + 1}", "image_x": p[0], "image_y": p[1], "ground_x_m": p[2], "ground_y_m": p[3], "provenance": "MEASURED"} for i, p in enumerate(points)], "reference_distances": [], "measured_rows": {"row_1": {"length_m": 10, "width_m": 2, "provenance": "MEASURED"}}})


def parking():
    polygon = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .3}, {"x": .1, "y": .3}]
    return ParkingCalibration.model_validate({"schema_version": 2, "camera_id": "CAM", "reference_image": {"width": 1000, "height": 800}, "parking_roi": {"polygon": polygon}, "rows": [{"id": f"row_{i}", "name": f"Parking Row {i}", "polygon": polygon} for i in range(1, 6)]})


class HomographyTest(unittest.TestCase):
    exact = [(0, 0, 1, 2), (1, 0, 3, 2), (1, 1, 3, 5), (0, 1, 1, 5)]

    def test_exact_four_point_homography_and_round_trip(self):
        image = np.asarray([p[:2] for p in self.exact], float)
        ground = np.asarray([p[2:] for p in self.exact], float)
        matrix = calculate_homography(image, ground)
        self.assertTrue(np.allclose(transform_point(.25, .5, matrix), (1.5, 3.5), atol=1e-9))
        inverse = np.linalg.inv(matrix)
        ground_point = transform_point(.25, .5, matrix)
        self.assertTrue(np.allclose(transform_point(*ground_point, inverse), (.25, .5), atol=1e-9))

    def test_more_than_four_points_and_error_statistics(self):
        points = self.exact + [(.5, .5, 2, 3.5), (.25, .75, 1.5, 4.25)]
        with tempfile.TemporaryDirectory() as directory:
            service = GroundPlaneHomographyService(Path(directory))
            response = service.calculate(calibration(points), parking())
            self.assertEqual(response.result.control_point_count, 6)
            self.assertEqual(response.result.inlier_count, 6)
            self.assertLess(response.result.rmse_m, 1e-8)
            self.assertLess(response.result.max_error_m, 1e-8)
            self.assertEqual(len(response.result.point_diagnostics), 6)
            self.assertEqual(response.result.status, "VALIDATED")
            self.assertEqual(len(response.result.roi_metric.points), 4)
            self.assertEqual(len(response.result.rows_metric), 5)

    def test_rejects_insufficient_collinear_and_duplicate_points(self):
        with self.assertRaises(HomographyInputError):
            calculate_homography(np.asarray([[0, 0], [1, 0], [1, 1]], float), np.asarray([[0, 0], [1, 0], [1, 1]], float))
        with self.assertRaises(HomographyInputError):
            calculate_homography(np.asarray([[0, 0], [.2, .2], [.4, .4], [.6, .6]], float), np.asarray([[0, 0], [1, 1], [2, 2], [3, 3]], float))
        with self.assertRaises(HomographyInputError):
            calculate_homography(np.asarray([[0, 0], [0, 0], [1, 1], [0, 1]], float), np.asarray([[0, 0], [1, 0], [1, 1], [0, 1]], float))

    def test_invalid_homogeneous_division(self):
        self.assertIsNone(transform_point(1, 0, np.asarray([[1, 0, 0], [0, 1, 0], [1, 0, -1]], float)))

    def test_fingerprint_stale_and_unchanged_current(self):
        source = calibration(self.exact + [(.5, .5, 2, 3.5)])
        with tempfile.TemporaryDirectory() as directory:
            service = GroundPlaneHomographyService(Path(directory))
            service.calculate(source, parking())
            self.assertTrue(service.get_response(source).current)
            changed = source.model_copy(deep=True)
            changed.control_points[0].ground_x_m = .1
            response = service.get_response(changed)
            self.assertEqual(response.status, "STALE")
            self.assertFalse(response.current)
            row_changed = source.model_copy(deep=True)
            row_changed.measured_rows["row_1"].length_m = 11
            self.assertEqual(source_fingerprint(source), source_fingerprint(row_changed))

    def test_calculation_does_not_modify_input_file(self):
        source = calibration(self.exact + [(.5, .5, 2, 3.5)])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ground_plane_calibration.json"
            path.write_text(json.dumps(source.model_dump(mode="json"), sort_keys=True), encoding="utf-8")
            before = path.read_bytes()
            GroundPlaneHomographyService(Path(directory)).calculate(source, parking())
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
