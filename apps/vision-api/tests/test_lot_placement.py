import math

import pytest

from app.models import MetricGroundPoint, ParkingAreaLiveState
from app.services.lot_placement_service import place_area_state, rigid_placement


def polygon(points):
    return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in points]]


SOURCE = polygon([(0, 0), (4, 0), (4, 2), (0, 2)])
PAYLOAD = {"ground_plane_homography.json": {"roi_metric": {"points": [p.model_dump() for p in SOURCE[0]]}}}


def test_calibration_roi_preview_preserves_placement_landmarks_and_original():
    from app.models import LotModelDefinition
    from app.services.lot_placement_service import replace_calibration_roi

    target = polygon([(10, 5), (10, 9), (8, 9), (8, 5)])
    definition = LotModelDefinition(outline=target, parking_areas=[{"parking_area_id": "area", "polygon": target}],
        landmarks=[{"landmark_id": "tree", "kind": "TREE", "position": {"x_m": 6, "y_m": 6}, "height_m": 3, "radius_m": 1, "measurement_source": "ESTIMATED"}])
    placement = rigid_placement(SOURCE, target)
    changed = polygon([(0, 0), (6, 0), (6, 2), (0, 2)])[0]
    preview = replace_calibration_roi(definition, "area", changed, placement)
    assert preview.parking_areas[0].polygon[0][1].y_m == pytest.approx(11)
    assert preview.outline == preview.parking_areas[0].polygon
    assert preview.landmarks == definition.landmarks
    assert definition.parking_areas[0].polygon == target


def test_import_changed_camera_roi_keeps_setup_edge_angle():
    from app.models import LotModelDefinition
    from app.services.lot_placement_service import replace_calibration_roi

    target = polygon([(10, 5), (10, 9), (8, 9), (8, 5)])
    definition = LotModelDefinition(outline=target, parking_areas=[{"parking_area_id": "area", "polygon": target}])
    angle = math.radians(3)
    changed = polygon([(math.cos(angle)*p.x_m-math.sin(angle)*p.y_m,
                        math.sin(angle)*p.x_m+math.cos(angle)*p.y_m) for p in SOURCE[0]])[0]
    preview = replace_calibration_roi(definition, "area", changed, rigid_placement(SOURCE, target))
    a, b = preview.parking_areas[0].polygon[0][:2]
    assert math.atan2(b.y_m-a.y_m, b.x_m-a.x_m) == pytest.approx(math.pi/2)
    # The entire new ROI still proves one rigid map transform; dimensions never stretch.
    assert rigid_placement([changed], preview.parking_areas[0].polygon) is not None


@pytest.mark.parametrize("points", [
    [(0, 0), (8, 0), (8, 2), (0, 2)],  # non-uniform scaling
    [(0, 0), (-4, 0), (-4, 2), (0, 2)],  # reflection
    [(0, 0), (4, 0), (5, 2), (0, 2)],  # corner deformation
])
def test_non_rigid_roi_never_reuses_available_evidence(points):
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[{"kind": "AVAILABLE", "polygon": SOURCE}])
    result = place_area_state(state, PAYLOAD, polygon(points))
    assert result.status == "CALIBRATION_MISMATCH"
    assert result.regions == result.motorcycles == []
    assert state.regions[0].kind == "AVAILABLE"


def test_uniform_display_scale_preserves_physical_width_and_proxy_dimensions():
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[
        {"kind": "WIDTH_SUFFICIENT", "width_m": 4, "polygon": SOURCE},
    ], motorcycles=[{"detection_id": "d1", "center": {"x_m": 1, "y_m": 1}, "heading_rad": 0,
                     "length_m": 2, "width_m": .66, "confidence": .9}])
    target = polygon([(10, 5), (10, 13), (6, 13), (6, 5)])
    result = place_area_state(state, PAYLOAD, target)
    assert result.status == "DEMO"
    assert result.regions[0].width_m == 4
    assert result.motorcycles[0].center.x_m == pytest.approx(8)
    assert result.motorcycles[0].center.y_m == pytest.approx(7)
    assert result.motorcycles[0].length_m == 2
    assert result.motorcycles[0].width_m == .66
    assert result.motorcycles[0].display_scale == pytest.approx(2)
    assert state.motorcycles[0].center.x_m == 1


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


def test_rotated_roi_clips_row_bands_and_moves_identified_car_together():
    from app.services.region_clipping_service import polygon_shape

    target = polygon([(10, 5), (10, 9), (8, 9), (8, 5)])
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", regions=[
        {"kind": "UNKNOWN", "row_id": "r", "polygon": polygon([(-1, 0), (5, 0), (5, 2), (-1, 2)])},
        {"kind": "OCCUPIED", "row_id": "r", "detection_id": "d1", "polygon": polygon([(1, 0), (2, 0), (2, 2), (1, 2)])},
    ], motorcycles=[{"detection_id": "d1", "center": {"x_m": 1.5, "y_m": 1}, "heading_rad": 0,
                     "length_m": 2, "width_m": .66, "confidence": .9}])
    result = place_area_state(state, PAYLOAD, target)
    assert all(polygon_shape(target).covers(polygon_shape(r.display_polygon or r.polygon)) for r in result.regions)
    assert result.regions[1].detection_id == "d1"
    assert result.motorcycles[0].center.x_m == pytest.approx(9)
    assert result.motorcycles[0].center.y_m == pytest.approx(6.5)
    assert result.motorcycles[0].heading_rad == pytest.approx(math.pi/2)
    assert result.motorcycles[0].length_m == 2
    assert place_area_state(state, PAYLOAD, target) == result  # polling never accumulates rotation
