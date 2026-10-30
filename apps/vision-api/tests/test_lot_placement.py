import math

import pytest

from app.models import MetricGroundPoint, ParkingAreaLiveState
from app.services.lot_placement_service import place_area_state, rigid_placement


def polygon(points):
    return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in points]]


SOURCE = polygon([(0, 0), (4, 0), (4, 2), (0, 2)])
PAYLOAD = {"ground_plane_homography.json": {"roi_metric": {"points": [p.model_dump() for p in SOURCE[0]]}}}


@pytest.mark.parametrize("points", [
    [(0, 0), (8, 0), (8, 4), (0, 4)],  # scaling
    [(0, 0), (-4, 0), (-4, 2), (0, 2)],  # reflection
    [(0, 0), (4, 0), (5, 2), (0, 2)],  # corner deformation
])
def test_non_rigid_roi_never_reuses_available_evidence(points):
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[{"kind": "AVAILABLE", "polygon": SOURCE}])
    result = place_area_state(state, PAYLOAD, polygon(points))
    assert result.status == "CALIBRATION_MISMATCH"
    assert result.regions == result.motorcycles == []
    assert state.regions[0].kind == "AVAILABLE"


@pytest.mark.parametrize("status", ["STALE", "CALIBRATION_MISMATCH", "NOT_CALIBRATED", "NO_DATA"])
def test_map_placement_never_restores_unavailable_evidence(status):
    state = ParkingAreaLiveState(parking_area_id="area", status=status)
    assert place_area_state(state, PAYLOAD, SOURCE) == state


def test_all_polygon_rings_rotate_and_closed_reference_ring_is_supported():
    source = [SOURCE[0] + [SOURCE[0][0]]]
    target = polygon([(10, 5), (10, 9), (8, 9), (8, 5)])
    placement = rigid_placement(source, target)
    assert placement is not None
    assert placement.angle == pytest.approx(math.pi / 2)
    hole = polygon([(1, 0.5), (2, 0.5), (2, 1)])[0]
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[{"kind": "UNKNOWN", "polygon": [SOURCE[0], hole]}])
    result = place_area_state(state, PAYLOAD, target)
    point = result.regions[0].polygon[1][0]
    assert point.x_m == pytest.approx(9.5)
    assert point.y_m == pytest.approx(6)
    assert state.regions[0].polygon[1][0].x_m == 1


def test_missing_or_malformed_camera_roi_does_not_publish_unplaced_evidence():
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[{"kind": "AVAILABLE", "polygon": SOURCE}])
    assert place_area_state(state, {"ground_plane_homography.json": {}}, SOURCE).status == "CALIBRATION_MISMATCH"
    assert place_area_state(state, PAYLOAD, None).status == "CALIBRATION_MISMATCH"
