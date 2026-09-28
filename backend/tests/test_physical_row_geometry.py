import tempfile
import unittest
from pathlib import Path

from app.models import PhysicalRowGeometryConfig
from app.services.physical_row_geometry_service import PhysicalRowGeometryService, nearest_polygon_boundary


class Point:
    def __init__(self, x, y): self.x, self.y = x, y


class PhysicalRowGeometryTest(unittest.TestCase):
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


if __name__ == "__main__": unittest.main()
