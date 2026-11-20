import json

import numpy as np
import pytest

from app.models import DetectionBBox, GroundPlaneCalibration, ParkingCalibration
from app.services.ground_plane_calibration_service import GroundPlaneCalibrationService
from app.services.ground_plane_homography_service import GroundPlaneHomographyService
from app.services.motorcycle_width_estimation import estimate_width_m


@pytest.mark.parametrize("bottom, expected", [(.4, .8 / 1.4), (.8, .8 / 1.8)])
def test_bbox_width_uses_local_ground_scale_at_its_bottom_centre(bottom, expected):
    matrix = np.array([[10., 0., 0.], [0., 10., 0.], [0., 1., 1.]])
    bbox = DetectionBBox(x=.4, y=bottom - .2, width=.08, height=.2)

    assert estimate_width_m(bbox, 1000, 500, matrix) == pytest.approx(expected)


def write_calibration(directory):
    ground = GroundPlaneCalibration.model_validate({
        "camera_id": "camera-1", "reference_image": {"width": 100, "height": 100},
        "coordinate_system": {"unit": "meter", "description": "Synthetic plane"},
        "control_points": [{"id": str(i), "image_x": x, "image_y": y,
                            "ground_x_m": 10 * x, "ground_y_m": 10 * y, "provenance": "MEASURED"}
                           for i, (x, y) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1), (.5, .5)])],
        "reference_distances": [],
        "measured_rows": {"row_1": {"length_m": 8, "width_m": 8, "provenance": "MEASURED"}},
    })
    polygon = [{"x": x, "y": y} for x, y in [(.1, .1), (.9, .1), (.9, .9), (.1, .9)]]
    parking = ParkingCalibration.model_validate({
        "camera_id": "camera-1", "reference_image": {"width": 100, "height": 100},
        "parking_roi": {"polygon": polygon}, "rows": [{"id": "row_1", "name": "Row", "polygon": polygon}],
    })
    GroundPlaneCalibrationService(directory).save(ground)
    (directory / "parking_calibration.json").write_text(json.dumps(parking.model_dump()))
    response = GroundPlaneHomographyService(directory).calculate(ground, parking)
    assert response.status == "VALIDATED"


def test_current_matching_camera_calibration_produces_per_detection_widths(tmp_path):
    from app.services.motorcycle_width_estimation import estimate_widths

    write_calibration(tmp_path)
    boxes = [DetectionBBox(x=.3, y=.3, width=.1, height=.2), DetectionBBox(x=.5, y=.3, width=.05, height=.2)]
    assert estimate_widths(boxes, 100, 100, tmp_path) == pytest.approx({0: 1., 1: .5})


@pytest.mark.parametrize("matrix", [np.zeros((3, 3)), np.full((3, 3), np.nan), np.diag([100., 100., 1.])])
def test_unusable_or_implausible_estimates_fall_back(matrix):
    assert estimate_width_m(DetectionBBox(x=.3, y=.3, width=.1, height=.2), 100, 100, matrix) is None


@pytest.mark.parametrize("change", ["missing", "invalid", "stale", "rows", "resolution"])
def test_estimates_are_omitted_when_calibration_cannot_support_the_frame(tmp_path, change):
    from app.services.motorcycle_width_estimation import estimate_widths

    write_calibration(tmp_path)
    path = tmp_path / "ground_plane_calibration.json"
    if change == "missing":
        path.unlink()
    elif change == "invalid":
        path.write_text("not JSON")
    elif change in ("stale", "rows"):
        data = json.loads(path.read_text())
        if change == "stale":
            data["control_points"][0]["ground_x_m"] += .1
        else:
            data["measured_rows"]["row_1"]["width_m"] = 7
        path.write_text(json.dumps(data))
    assert estimate_widths([DetectionBBox(x=.3, y=.3, width=.1, height=.2)],
                           200 if change == "resolution" else 100, 100, tmp_path) == {}


@pytest.mark.parametrize("value", [0, -1, 3.01, float("nan"), float("inf")])
def test_worker_contract_rejects_invalid_display_widths(value):
    from pydantic import ValidationError

    from app.models import MotorcycleProxy

    with pytest.raises(ValidationError):
        MotorcycleProxy(detection_id="d1", center={"x_m": 0, "y_m": 0}, heading_rad=0,
                        width_m=.66, length_m=2, confidence=.9, estimated_width_m=value)
