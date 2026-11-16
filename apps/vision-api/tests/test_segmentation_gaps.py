import pytest
from shapely.affinity import rotate
from shapely.geometry import Polygon, box

from app.services.capacity_service import calculate_capacity
from app.services.parking_analysis_service import _geometry
from app.services.segmentation_gap_service import evaluate_gap_geometry
from app.services.virtual_fitting_service import fit_rows


def scene(width=.66, depth=2., uncertain=False):
    row = Polygon([(0, 0), (2 + width, 0), (2 + width, depth), (0, depth)])
    occupied = box(0, 0, 1, depth).union(box(1 + width, 0, 2 + width, depth))
    free = row.difference(occupied)
    rows = [("row_1", row)]
    return {"physical_map": {"parking_roi": _geometry(row), "rows": [{"row_id": "row_1", "polygon": _geometry(row)["polygons"][0][0]}]},
        "detections": [{"canonical_footprint": _geometry(occupied)}],
        "capacity": calculate_capacity(rows, {"row_1": free}, fit_rows(rows, {"row_1": free})),
        "uncertainty": {"validation": True, "rows": [{"row_id": "row_1", "status": "UNCERTAIN" if uncertain else "CLEAR"}]}}


INVERSE = [[.1, 0, 0], [0, .1, 0], [0, 0, 1]]


def test_nearest_image_lower_edge_owns_vehicle_even_inside_another_row():
    from shapely.geometry import LineString

    from app.models import DetectionBBox
    from app.services.segmentation_gap_service import _nearest_image_edge_assignment

    rows = {"row_1": box(.1, .5, .9, .7), "row_2": box(.1, .3, .9, .5)}
    edges = {"row_1": LineString([(.1, .7), (.9, .7)]),
        "row_2": LineString([(.1, .5), (.9, .5)])}
    # Bottom .52 is inside row_1, but visually closest to row_2's lower line.
    bbox = DetectionBBox(x=.4, y=.32, width=.2, height=.2)
    assert _nearest_image_edge_assignment(bbox, edges, rows, 1000, 800, 0.) == (
        "row_2", "IMAGE_NEAREST_EDGE", "ASSIGNED_BY_NEAREST_IMAGE_EDGE")
    middle = bbox.model_copy(update={"y": .4})
    assert _nearest_image_edge_assignment(middle, edges, rows, 1000, 800, 0.)[2] == "AMBIGUOUS_IMAGE_EDGES"
    near_tie = bbox.model_copy(update={"y": .401})
    assert _nearest_image_edge_assignment(near_tie, edges, rows, 1000, 800, 0.)[0] is None
    outside_span = bbox.model_copy(update={"x": .91, "width": .05})
    assert _nearest_image_edge_assignment(outside_span, edges, rows, 1000, 800, 0.)[2] == "OUTSIDE_ROW_SPAN"
    assert _nearest_image_edge_assignment(bbox, edges, rows, 1000, 800, .41)[2] == "OUTSIDE_ROI"


def test_bottom_edge_assignment_can_choose_row_above_the_containing_row():
    from shapely.geometry import LineString

    analysis = scene(.8, 2.)
    analysis["physical_map"]["parking_roi"] = _geometry(box(0, 0, 2.8, 4))
    analysis["physical_map"]["rows"].append({"row_id": "row_2", "polygon":
        _geometry(Polygon([(0, 2), (2.8, 2), (2.8, 4), (0, 4)]))["polygons"][0][0]})
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 1.33, "y_m": 1.95},
        "canonical_footprint": _geometry(box(1, 1.95, 1.66, 3.95)),
        "row_assignment_v2": {"state": "POINT_ASSIGNED", "assigned_row_id": "row_1"}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True,
        row_bottom_edges={"row_1": LineString([(0, 0), (2.8, 0)]), "row_2": LineString([(0, 2), (2.8, 2)])})
    assert result.occupied_layers[0].assigned_row_id == "row_2"
    assert result.occupied_layers[0].row_assignment_source == "BOTTOM_EDGE_APPROXIMATE"
    assert result.occupied_layers[0].row_assignment_distance_m == pytest.approx(.05)
    assert "detection_1" in result.uncertain_reference_ids
    assert result.rows[0].bottom_edge_metric


def test_bottom_edge_assignment_rejects_points_past_endpoints_far_away_or_tied():
    from shapely.geometry import LineString, Point

    from app.services.segmentation_gap_service import _bottom_edge_row

    edges = {"row_1": LineString([(0, 0), (4, 0)]), "row_2": LineString([(0, .3), (4, .3)])}
    roi = box(-1, -1, 5, 2)
    assert _bottom_edge_row(Point(2, .15), edges, roi)[0] is None
    assert _bottom_edge_row(Point(4.05, .01), edges, roi)[0] is None
    assert _bottom_edge_row(Point(2, .6), edges, roi)[0] is None
    assert _bottom_edge_row(Point(2, .28), edges, roi)[0] == "row_2"


def test_row_distance_witness_matches_measured_nearest_edge_and_zero_on_line():
    from shapely.geometry import LineString, Point

    from app.services.segmentation_gap_service import _row_distance_witness

    edges = {"row_1": LineString([(0, 0), (4, 0)]), "row_2": LineString([(0, 3), (4, 3)])}
    witness = _row_distance_witness(Point(2, .19), edges, INVERSE)
    assert witness["nearest_row_id"] == "row_1"
    start, end = witness["distance_line_metric"]
    assert (start.x_m, start.y_m) == pytest.approx((2, .19))
    assert (end.x_m, end.y_m) == pytest.approx((2, 0))
    assert start.y_m-end.y_m == pytest.approx(.19)
    assert witness["distance_line_image"][0].y == pytest.approx(.019)
    zero = _row_distance_witness(Point(2, 0), edges, INVERSE)
    assert zero["distance_line_metric"][0] == zero["distance_line_metric"][1]
    tilted = _row_distance_witness(Point(2, 1), {"row_tilted": LineString([(0, 0), (4, 2)])}, INVERSE)
    assert tilted["distance_line_metric"][0] == tilted["distance_line_metric"][1]
    assert _row_distance_witness(Point(5, .19), edges, INVERSE) == {}


def test_nearest_edge_reserves_one_row_width_band_even_when_old_reference_points_away():
    from shapely.geometry import LineString

    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(2., 2.)
    analysis["physical_map"]["parking_roi"] = _geometry(box(0, 0, 4, 4))
    analysis["physical_map"]["rows"].append({"row_id": "row_2", "polygon":
        _geometry(Polygon([(0, 2), (4, 2), (4, 4), (0, 4)]))["polygons"][0][0]})
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 2, "y_m": 2.05},
        "canonical_footprint": _geometry(box(1.67, 2.05, 2.33, 4.05)),
        "row_assignment_v2": {"state": "POINT_ASSIGNED", "assigned_row_id": "row_2"}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True,
        row_bottom_edges={"row_1": LineString([(0, 2), (4, 2)]), "row_2": LineString([(0, 4), (4, 4)])})
    layer = result.occupied_layers[0]
    assert layer.assigned_row_id == "row_1"
    band = _geometry_to_shapely(layer.row_depth_geometry.model_dump())
    assert band.equals(box(1.67, 0, 2.33, 2))
    assert _geometry_to_shapely(result.occupied_metric.model_dump()).equals(band)
    assert band.intersection(box(0, 2, 4, 4)).area == 0
    assert layer.row_assignment_reason == "ASSIGNED"


def test_mask_supported_single_row_fallback_is_bounded_and_does_not_pick_another_row():
    from shapely.geometry import LineString, Point

    from app.services.segmentation_gap_service import _supported_bottom_edge_assignment

    rows = {"row_1": box(0, 0, 4, 2), "row_2": box(0, 3, 4, 5)}
    edges = {"row_1": LineString([(0, 0), (4, 0)]), "row_2": LineString([(0, 3), (4, 3)])}
    roi = box(0, 0, 4, 5)
    accepted = _supported_bottom_edge_assignment(Point(2, .6), edges, roi, rows, {"row_1"})
    assert accepted[0] == "row_1"
    assert accepted[3] == "ASSIGNED_WITH_MASK"
    assert _supported_bottom_edge_assignment(Point(2, .6), edges, roi, rows, set())[0] is None
    assert _supported_bottom_edge_assignment(Point(2, .6), edges, roi, rows, {"row_2"})[0] is None
    assert _supported_bottom_edge_assignment(Point(2, 1.2), edges, roi, rows, {"row_1"})[0] is None
    assert _supported_bottom_edge_assignment(Point(2, -.1), edges, roi, rows, {"row_1"})[0] == "row_1"
    assert _supported_bottom_edge_assignment(Point(4.1, .6), edges, roi, rows, {"row_1"})[0] is None


@pytest.mark.parametrize("offset,accepted", [(.17, True), (.35, True), (.4, True), (.40001, False)])
def test_mask_support_accepts_only_bounded_outside_roi_points(offset, accepted):
    from shapely.geometry import LineString, Point

    from app.services.segmentation_gap_service import _supported_bottom_edge_assignment

    rows = {"row_1": box(0, 0, 4, 2), "row_2": box(0, 3, 4, 5)}
    edges = {"row_1": LineString([(0, 0), (4, 0)]), "row_2": LineString([(0, 3), (4, 3)])}
    roi = box(0, 0, 4, 5)
    point = Point(2, -offset)
    owner, _, _, reason = _supported_bottom_edge_assignment(point, edges, roi, rows, {"row_1"})
    assert owner == ("row_1" if accepted else None)
    if accepted:
        assert reason == "ASSIGNED_NEAR_ROI_WITH_MASK"
    assert _supported_bottom_edge_assignment(point, edges, roi, rows, set())[0] is None
    assert _supported_bottom_edge_assignment(point, edges, roi, rows, {"row_2"})[0] is None


@pytest.mark.parametrize("anchor_y,reason", [(.6, "ASSIGNED_WITH_MASK"), (-.35, "ASSIGNED_NEAR_ROI_WITH_MASK")])
def test_mask_supported_vehicle_has_only_one_occupied_row_band_and_keeps_uncertainty(anchor_y, reason):
    from shapely.geometry import LineString

    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(2., 2.)
    analysis["physical_map"]["parking_roi"] = _geometry(box(0, 0, 4, 5))
    analysis["physical_map"]["rows"].append({"row_id": "row_2", "polygon":
        _geometry(Polygon([(0, 3), (4, 3), (4, 5), (0, 5)]))["polygons"][0][0]})
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 2, "y_m": anchor_y},
        "canonical_footprint": _geometry(box(1.67, anchor_y, 2.33, anchor_y+2)),
        "row_assignment_v2": {"state": "AMBIGUOUS", "assigned_row_id": None}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True,
        row_bottom_edges={"row_1": LineString([(0, 0), (4, 0)]), "row_2": LineString([(0, 3), (4, 3)])},
        row_mask_support={"detection_1": {"row_1", "row_2"}})
    assert len(result.occupied_layers) == 1
    layer = result.occupied_layers[0]
    assert layer.assigned_row_id == "row_1"
    assert layer.row_assignment_source == "MASK_SUPPORTED_NEAREST_EDGE"
    assert layer.row_assignment_reason == reason
    band = _geometry_to_shapely(layer.row_depth_geometry.model_dump())
    assert band.bounds == pytest.approx((1.67, 0, 2.33, 2))
    assert band.intersection(box(0, 3, 4, 5)).area == 0
    assert result.uncertain_reference_ids == ["detection_1"]


@pytest.mark.parametrize("reverse", [False, True])
def test_lower_edge_comes_from_image_bottom_independent_of_winding(reverse):
    from app.models import ParkingCalibration
    from app.services.segmentation_gap_service import _row_bottom_edges

    points = [{"x": .1, "y": .1}, {"x": .9, "y": .12}, {"x": .88, "y": .3}, {"x": .08, "y": .28}]
    calibration = ParkingCalibration.model_validate({"camera_id": "test", "reference_image": {"width": 1000, "height": 800},
        "parking_roi": {"polygon": points}, "rows": [{"id": "row_1", "name": "row", "polygon": points[::-1] if reverse else points}]})
    line = _row_bottom_edges(calibration, [[10, 0, 0], [0, -10, 10], [0, 0, 1]])["row_1"]
    for actual, expected in zip(sorted(line.coords), [(.8, 7.2), (8.8, 7.)], strict=True):
        assert actual == pytest.approx(expected)


@pytest.mark.parametrize("offset,expected", [(.19, "row_1"), (.20, "row_1"), (.20001, None), (.21, None)])
def test_nearest_row_fallback_is_bounded_and_remains_uncertain(offset, expected):
    analysis = scene(.8, 2.)
    analysis["physical_map"]["parking_roi"] = _geometry(box(0, -.5, 2.8, 2))
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 1.33, "y_m": -offset},
        "canonical_footprint": _geometry(box(1, -offset, 1.66, 2-offset)),
        "row_assignment_v2": {"state": "UNASSIGNED", "assigned_row_id": None}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True)
    layer = result.occupied_layers[0]
    assert layer.assigned_row_id == expected
    assert layer.row_assignment_source == ("NEAREST_APPROXIMATE" if expected else "UNRESOLVED")
    assert layer.row_assignment_distance_m == pytest.approx(offset)
    assert result.uncertain_reference_ids == ["detection_1"]
    assert result.green_count == 0


def test_nearest_row_fallback_does_not_choose_between_similarly_near_rows():
    from shapely.geometry import Point

    from app.services.segmentation_gap_service import _anchor_row

    rows = {"row_1": box(0, 0, 4, 1), "row_2": box(0, 1.3, 4, 2.3)}
    assert _anchor_row(Point(2, 1.14), rows, box(0, 0, 4, 2.3))[0] is None
    assert _anchor_row(Point(2, 1.04), rows, box(0, 0, 4, 2.3))[:2] == ("row_1", "NEAREST_APPROXIMATE")
    assert _anchor_row(Point(2, .8), rows, box(0, 0, 4, 2.3))[:2] == ("row_1", "BOTTOM_CENTRE")
    assert _anchor_row(Point(2, -.1), rows, box(0, 0, 4, 2.3))[0] is None


def test_far_outside_anchor_reference_is_retained_as_uncertain_without_confirming_owner():
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 1.33, "y_m": -.3},
        "canonical_footprint": _geometry(box(1, -.2, 1.66, 1.8)),
        "row_assignment_v2": {"state": "FOOTPRINT_ASSIGNED", "assigned_row_id": "row_1"}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, localize_row_uncertainty=True, row_owned_references=True)
    assert not _geometry_to_shapely(result.occupied_metric.model_dump()).is_empty
    assert result.occupied_layers[0].row_depth_geometry.polygons
    assert result.occupied_layers[0].assigned_row_id is None
    assert result.uncertain_reference_ids == ["detection_1"]
    assert result.green_count == 0
    assert result.candidates
    assert all(item.state == "UNKNOWN" for item in result.candidates)
    assert any("detection_1" in item.width_blocking_detection_ids for item in result.candidates)


@pytest.mark.parametrize("state", ["POINT_ASSIGNED", "FOOTPRINT_ASSIGNED", "AMBIGUOUS"])
@pytest.mark.parametrize("upper_start", [2.5, 1.8])
def test_row_owned_reference_does_not_reserve_neighbour_row_but_keeps_ambiguity(state, upper_start):
    from app.services.parking_analysis_service import _geometry_to_shapely

    lower = Polygon([(0, 0), (4, 0), (4, 2), (0, 2)])
    upper = Polygon([(0, upper_start), (4, upper_start), (4, upper_start+2), (0, upper_start+2)])
    footprint = box(1, 1, 1.66, 3)
    analysis = scene()
    analysis["physical_map"] = {"parking_roi": _geometry(box(0, 0, 4, 4.5)), "rows": [
        {"row_id": key, "polygon": _geometry(shape)["polygons"][0][0]} for key, shape in [("row_1", lower), ("row_2", upper)]]}
    analysis["detections"] = [{"detection_id": "detection_1", "canonical_footprint": _geometry(footprint),
        "transform_valid": True, "metric_ground_point": {"x_m": 1.33, "y_m": 1},
        "row_assignment_v2": {"state": state, "assigned_row_id": None if state == "AMBIGUOUS" else "row_2" if state == "FOOTPRINT_ASSIGNED" else "row_1"}}]
    analysis["capacity"]["rows"] = [{"row_id": key, "placements": [], "validation": {"valid": True}} for key in ["row_1", "row_2"]]
    analysis["uncertainty"] = {"validation": True, "rows": [{"row_id": key,
        "status": "UNCERTAIN" if state == "AMBIGUOUS" else "CLEAR",
        "reasons": ["AMBIGUOUS_ROW_ASSIGNMENT"] if state == "AMBIGUOUS" else [],
        "affected_detection_ids": ["detection_1"] if state == "AMBIGUOUS" else []} for key in ["row_1", "row_2"]]}
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True)
    layer = result.occupied_layers[0]
    assert _geometry_to_shapely(layer.geometry.model_dump()).equals(footprint)
    bands = _geometry_to_shapely(layer.row_depth_geometry.model_dump())
    if state == "AMBIGUOUS":
        assert layer.assigned_row_id == "row_1"
        assert bands.equals(box(1, 0, 1.66, 2))
        assert result.uncertain_reference_ids == ["detection_1"]
        assert all(item.state == "UNKNOWN" for item in result.candidates if item.row_id == "row_1")
    else:
        assert layer.assigned_row_id == "row_1"
        assert bands.equals(box(1, 0, 1.66, 2))
        assert _geometry_to_shapely(result.occupied_metric.model_dump()).equals(footprint.intersection(lower))
        assert any(item.row_id == "row_2" and item.state == "WIDTH_SUFFICIENT" and item.gap_width_m == pytest.approx(4.) for item in result.candidates)
        occluded = evaluate_gap_geometry(analysis, INVERSE, [box(.1, .26, .17, .28)], evidence_count=1,
            continuous_gaps=True, row_owned_references=True)
        assert all(item.state == "UNKNOWN" and "GROUND_MAY_BE_OCCLUDED" in item.reasons
            for item in occluded.candidates if item.row_id == "row_2")
    assert analysis["detections"][0]["canonical_footprint"] == _geometry(footprint)


def test_outside_bottom_centre_is_unknown_even_when_mask_suggests_a_row():
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    shape = box(1, -.2, 1.66, 1.8)
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 1.33, "y_m": -.3},
        "canonical_footprint": _geometry(shape),
        "image_row_assignment": "row_1",
        "row_assignment_v2": {"state": "UNASSIGNED", "assigned_row_id": None}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True)
    assert result.occupied_layers[0].assigned_row_id is None
    assert _geometry_to_shapely(result.occupied_metric.model_dump()).equals(shape)
    assert result.occupied_layers[0].row_depth_geometry.polygons
    assert result.uncertain_reference_ids == ["detection_1"]
    assert result.green_count == 0


def test_bottom_centre_in_two_overlapping_rows_does_not_guess_a_row_from_mask():
    analysis = scene(.8, 2.)
    analysis["physical_map"]["rows"].append({"row_id": "row_2",
        "polygon": _geometry(Polygon([(0, 1.8), (2.8, 1.8), (2.8, 3.8), (0, 3.8)]))["polygons"][0][0]})
    analysis["detections"] = [{"detection_id": "detection_1", "transform_valid": True,
        "metric_ground_point": {"x_m": 1.33, "y_m": 1.9},
        "canonical_footprint": _geometry(box(1, 1.9, 1.66, 3.9)),
        "image_row_assignment": "row_2",
        "row_assignment_v2": {"state": "AMBIGUOUS", "assigned_row_id": None}}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, row_owned_references=True)
    assert result.occupied_layers[0].assigned_row_id is None
    assert result.uncertain_reference_ids == ["detection_1"]
    assert result.green_count == 0


def test_1521_outside_mask_tiny_row_contact_is_not_occupancy_evidence():
    from app.services.segmentation_gap_service import _mask_in_selected_rows

    mask = box(0, 0, 1, 1)
    for fraction in [.027, .065, .066, .036]:
        assert not _mask_in_selected_rows(mask, box(0, 0, 1, fraction))
    assert _mask_in_selected_rows(mask, box(0, 0, 1, .5))
    assert not _mask_in_selected_rows(None, box(0, 0, 1, 1))


@pytest.mark.parametrize("angle", [0, 27])
def test_occupied_display_fills_row_depth_without_changing_vehicle_geometry(angle):
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    row = rotate(Polygon([(0, 0), (2.8, 0), (2.8, 2), (0, 2)]), angle, origin=(0, 0))
    vehicle = rotate(box(.4, .5, 1.1, 1.2), angle, origin=(0, 0))
    expected = rotate(box(.4, 0, 1.1, 2), angle, origin=(0, 0))
    analysis["physical_map"]["parking_roi"] = _geometry(row)
    analysis["physical_map"]["rows"][0]["polygon"] = _geometry(row)["polygons"][0][0]
    analysis["detections"] = [{"canonical_footprint": _geometry(vehicle)}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True)
    layer = result.occupied_layers[0]
    display = _geometry_to_shapely(layer.row_depth_geometry.model_dump())
    assert display.symmetric_difference(expected).area < 1e-8
    assert _geometry_to_shapely(layer.geometry.model_dump()).equals(vehicle)
    assert _geometry_to_shapely(result.occupied_metric.model_dump()).equals(vehicle)
    assert vehicle.area < display.area


def test_occupied_display_respects_roi_holes_and_ignores_aisle_and_boundary_contacts():
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    row = Polygon([(0, 0), (2.8, 0), (2.8, 2), (0, 2)])
    hole = box(.6, .8, .8, 1.2)
    roi = row.difference(hole)
    analysis["physical_map"]["parking_roi"] = _geometry(roi)
    shapes = [box(.4, .5, 1.1, 1.2), box(.2, 2.1, .7, 2.8), box(1.5, 2, 2, 3)]
    analysis["detections"] = [{"canonical_footprint": _geometry(shape)} for shape in shapes]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=3, continuous_gaps=True)
    display = _geometry_to_shapely(result.occupied_layers[0].row_depth_geometry.model_dump())
    assert display.symmetric_difference(box(.4, 0, 1.1, 2).difference(hole)).area < 1e-8
    assert roi.covers(display)
    assert all(layer.row_depth_geometry.polygons == [] for layer in result.occupied_layers[1:])
    assert all(_geometry_to_shapely(layer.geometry.model_dump()).equals(shape)
        for layer, shape in zip(result.occupied_layers, shapes, strict=True))


def test_visible_shapes_keep_partial_depth_free_ground_with_measured_width():
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    analysis["detections"][0]["canonical_footprint"] = _geometry(box(0, 0, 1, 1).union(box(1.8, 0, 2.8, 2)))
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        visible_free_shapes=True, slot_width_m=.66)
    assert result.evaluation_mode == "VISIBLE_FREE_SHAPES"
    candidate = next(item for item in result.candidates if item.state == "WIDTH_SUFFICIENT")
    shape = _geometry_to_shapely(candidate.geometry_metric.model_dump())
    assert shape.covers(Polygon([(0, 1), (1, 1), (1, 2), (0, 2)]))
    assert shape.area == pytest.approx(2.6)
    assert candidate.gap_width_m == pytest.approx(1.8)
    assert candidate.depth_at_width_midpoint_m == pytest.approx(1.)
    assert candidate.slot_length_m is None
    assert candidate.visibility == "VISIBLE"


def test_visible_shapes_split_only_occluded_ground_and_preserve_holes():
    from shapely.ops import unary_union

    from app.services.parking_analysis_service import _geometry_to_shapely

    for mask in [box(.14, 0, .15, .19), box(.12, .05, .14, .10)]:
        analysis = scene(.8, 1.9)
        result = evaluate_gap_geometry(analysis, INVERSE, [mask], evidence_count=1,
            visible_free_shapes=True, slot_width_m=.30, image_occluder_details=[(0, "MASK", mask)])
        shapes = [(item, _geometry_to_shapely(item.geometry_metric.model_dump())) for item in result.candidates]
        free = box(1, 0, 1.8, 1.9)
        assert unary_union([shape for _, shape in shapes]).symmetric_difference(free).area < 1e-8
        for index, (item, shape) in enumerate(shapes):
            assert all(shape.intersection(other).area < 1e-8 for _, other in shapes[:index])
            if item.visibility == "OCCLUDED":
                assert item.state == "UNKNOWN"
                assert "GROUND_MAY_BE_OCCLUDED" in item.reasons
            else:
                assert item.state == "WIDTH_SUFFICIENT"
                image_shapes = [Polygon([(p.x, p.y) for p in rings[0]], [[(p.x, p.y) for p in ring] for ring in rings[1:]]) for rings in item.geometry_image.polygons]
                assert all(image_shape.intersection(mask).area < 1e-10 for image_shape in image_shapes)
        assert result.green_count >= 1
        assert result.unknown_count >= 1
        if mask.bounds[1] > 0:
            assert any(len(item.geometry_metric.polygons[0]) == 2 for item, _ in shapes if item.visibility == "VISIBLE")


def test_visible_shapes_never_use_bbox_span_across_a_diagonal_sliver_as_width():
    row = box(0, 0, 2, 2)
    free = Polygon([(0, 0), (.3, 0), (1.3, 2), (1, 2)])
    analysis = scene()
    analysis["physical_map"] = {"parking_roi": _geometry(row), "rows": [{"row_id": "row_1", "polygon": [{"x_m": 0, "y_m": 0}, {"x_m": 2, "y_m": 0}, {"x_m": 2, "y_m": 2}, {"x_m": 0, "y_m": 2}]}]}
    analysis["detections"] = [{"canonical_footprint": _geometry(row.difference(free))}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, visible_free_shapes=True, slot_width_m=.66)
    assert result.green_count == 0
    assert result.candidates[0].gap_width_m == pytest.approx(.3)
    assert result.candidates[0].state == "UNKNOWN"
    assert "WIDTH_NOT_PROVEN" in result.candidates[0].reasons


@pytest.mark.parametrize("case", ["no_evidence", "uncertain_row", "bad_projection", "limit"])
def test_visible_shapes_keep_global_uncertainty_and_limits(case, monkeypatch):
    from app.services import segmentation_gap_service

    if case == "limit":
        monkeypatch.setattr(segmentation_gap_service, "MAX_CANDIDATES", 0)
    result = evaluate_gap_geometry(scene(.8, 1.9, uncertain=case == "uncertain_row"), [[0, 0, 0]]*3 if case == "bad_projection" else INVERSE, [],
        evidence_count=0 if case == "no_evidence" else 1, visible_free_shapes=True, slot_width_m=.66)
    assert result.green_count == 0
    if case == "limit":
        assert result.truncated
        assert result.candidates == []
    else:
        assert all(item.state == "UNKNOWN" for item in result.candidates)


def test_bbox_orientation_preview_uses_pixel_ratio_and_preserves_reference_centre():
    from app.models import DetectionBBox
    from app.services.parking_analysis_service import _geometry_to_shapely
    from app.services.segmentation_gap_service import build_bbox_orientation_hypothesis

    baseline = box(1, 1, 1.66, 3)
    bbox = DetectionBBox(x=.2, y=.2, width=.12, height=.2)
    wide = build_bbox_orientation_hypothesis(bbox, 400, 200, _geometry(baseline), INVERSE, "detection_1", 0)
    assert wide.image_orientation == "HORIZONTAL_IMAGE"
    assert wide.pixel_aspect_ratio == pytest.approx(1.2)
    assert wide.proposed_rotation_deg == 90
    proposed = _geometry_to_shapely(wide.geometry.model_dump())
    assert proposed.centroid.distance(baseline.centroid) < 1e-10
    assert proposed.area == pytest.approx(.66*2)
    assert proposed.bounds[2]-proposed.bounds[0] == pytest.approx(2)
    assert proposed.bounds[3]-proposed.bounds[1] == pytest.approx(.66)
    assert wide.image_geometry is not None
    # Same normalized bbox, different image dimensions: ratio must use pixels.
    tall = build_bbox_orientation_hypothesis(bbox, 200, 400, _geometry(baseline), INVERSE, "detection_1", 0)
    assert tall.image_orientation == "VERTICAL_IMAGE"
    assert tall.proposed_rotation_deg == 0
    square = build_bbox_orientation_hypothesis(bbox, 400, 240, _geometry(baseline), INVERSE, "detection_1", 0)
    assert square.image_orientation == "AMBIGUOUS_IMAGE"
    assert square.geometry is None
    assert square.proposed_rotation_deg is None
    invalid_projection = build_bbox_orientation_hypothesis(bbox, 400, 200, _geometry(baseline), [[0, 0, 0]]*3, "detection_1", 0)
    assert invalid_projection.geometry is not None
    assert invalid_projection.image_geometry is None
    with pytest.raises(ValueError):
        build_bbox_orientation_hypothesis(bbox, 0, 200, _geometry(baseline), INVERSE, "detection_1", 0)


def test_occlusion_evidence_is_bounded_without_changing_unknown_or_projection_gates(monkeypatch):
    from app.services import segmentation_gap_service

    monkeypatch.setattr(segmentation_gap_service, "MAX_OCCLUSION_EVIDENCE", 1)
    sources = [(0, "MASK", box(.10, 0, .13, .19)), (1, "BBOX_FALLBACK", box(.16, 0, .18, .19))]
    shapes = [shape for _, _, shape in sources]
    result = evaluate_gap_geometry(scene(.8, 1.9), INVERSE, shapes, evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, image_occluder_details=sources)
    gap = result.candidates[0]
    assert gap.state == "UNKNOWN"
    assert result.green_count == 0
    assert gap.occlusion_evidence_available
    assert gap.occlusion_evidence_truncated
    assert len(gap.occlusion_evidence) == 1
    assert gap.occlusion_evidence[0].candidate_overlap_ratio == pytest.approx(.03/.08)
    plain = evaluate_gap_geometry(scene(.8, 1.9), INVERSE, shapes, evidence_count=1,
        continuous_gaps=True, slot_width_m=.75)
    assert plain.candidates[0].state == gap.state
    assert plain.candidates[0].reasons == gap.reasons
    assert not plain.candidates[0].occlusion_evidence_available
    invalid = evaluate_gap_geometry(scene(.8, 1.9), [[0, 0, 0]]*3, shapes, evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, image_occluder_details=sources)
    assert not invalid.candidates[0].occlusion_evidence_available
    assert invalid.candidates[0].occlusion_evidence == []


def test_background_regions_explain_occupied_and_unassessed_white_ground():
    from shapely.ops import unary_union

    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    # A short reference blocks the full-depth corridor, leaving white ground
    # behind it that is neither occupied nor an evaluated candidate.
    occupied = box(0, 0, 1, 1).union(box(1.8, 0, 2.8, 2))
    analysis["detections"][0]["canonical_footprint"] = _geometry(occupied)
    mask = box(0, .1, .1, .2)
    result = evaluate_gap_geometry(analysis, INVERSE, [mask], evidence_count=1,
        continuous_gaps=True, slot_width_m=.66, image_occluder_details=[(0, "MASK", mask)])
    known = [item for item in result.background_regions if item.kind == "OCCUPIED_REFERENCE"]
    unassessed = [item for item in result.background_regions if item.kind == "NOT_EVALUATED"]
    assert known and unassessed
    assert all(item.detection_ids for item in known)
    white = unary_union([_geometry_to_shapely(item.geometry.model_dump()) for item in unassessed])
    assert white.area == pytest.approx(1.)
    assert white.covers(Polygon([(0, 1), (1, 1), (1, 2), (0, 2)]))
    assert all("NO_FULL_DEPTH_CANDIDATE" in item.reasons for item in unassessed)
    region = unassessed[0]
    assert region.image_geometry is not None
    assert region.occlusion_evidence_available
    assert region.occlusion_evidence[0].detection_index == 0
    assert region.occlusion_evidence[0].candidate_overlap_ratio == pytest.approx(1.)
    assert region.depth_blockers[0].detection_index == 0
    assert region.depth_blockers[0].source_kind == "MASK"
    # A depth blocker is still explained when its image mask does not cover
    # the white ground. Do not conflate row-depth exclusion with occlusion.
    lower_mask = box(0, 0, .1, .1)
    no_image_overlap = evaluate_gap_geometry(analysis, INVERSE, [lower_mask], evidence_count=1,
        continuous_gaps=True, slot_width_m=.66, image_occluder_details=[(0, "MASK", lower_mask)])
    other = next(item for item in no_image_overlap.background_regions if item.kind == "NOT_EVALUATED")
    assert other.occlusion_evidence_available
    assert other.occlusion_evidence == []
    assert other.depth_blockers[0].detection_index == 0
    assert no_image_overlap.green_count == result.green_count
    backgrounds = unary_union([_geometry_to_shapely(item.geometry.model_dump()) for item in result.background_regions])
    candidates = unary_union([Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]) for item in result.candidates])
    assert backgrounds.intersection(candidates).area < 1e-10
    assert backgrounds.union(candidates).area == pytest.approx(2.8*2)
    assert result.green_count == 1

    # Filtering must not reindex a blocker to another vehicle in the image.
    analysis["detections"][0].update(detection_id="detection_8", detection_index=7)
    filtered = evaluate_gap_geometry(analysis, INVERSE, [mask], evidence_count=1,
        continuous_gaps=True, slot_width_m=.66, image_occluder_details=[(7, "MASK", mask)])
    filtered_white = next(item for item in filtered.background_regions if item.kind == "NOT_EVALUATED")
    assert filtered_white.depth_blockers[0].detection_index == 7
    assert filtered_white.depth_blockers[0].detection_id == "detection_8"
    assert filtered_white.depth_blockers[0].source_kind == "MASK"


@pytest.mark.parametrize("case", ["no_evidence", "truncated", "roi_hole"])
def test_background_explanations_preserve_missing_evidence_limits_and_roi(case, monkeypatch):
    from app.services import segmentation_gap_service
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.8, 2.)
    hole = box(.2, .2, .4, .6)
    if case == "truncated":
        monkeypatch.setattr(segmentation_gap_service, "MAX_CANDIDATES", 0)
    if case == "roi_hole":
        analysis["physical_map"]["parking_roi"] = _geometry(box(0, 0, 2.8, 2).difference(hole))
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=0 if case == "no_evidence" else 1,
        continuous_gaps=True, slot_width_m=.66)
    if case == "roi_hole":
        assert all(_geometry_to_shapely(item.geometry.model_dump()).intersection(hole).area < 1e-10 for item in result.background_regions)
        assert result.green_count == 1
    else:
        reason = "NO_SEGMENTATION_EVIDENCE_IN_ROI" if case == "no_evidence" else "CANDIDATE_LIMIT_REACHED"
        assert any(item.kind == "NOT_EVALUATED" and reason in item.reasons for item in result.background_regions)
        assert result.green_count == 0
        assert result.candidates == []


def test_small_visible_width_conflict_is_yellow_advisory_not_green():
    result = evaluate_gap_geometry(scene(.70, 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, near_fit_advisories=True)
    candidate = result.candidates[0]
    assert candidate.state == "ALMOST_AVAILABLE"
    assert candidate.width_check == "INSUFFICIENT"
    assert result.green_count == 0
    assert result.almost_count == 1
    assert result.rows[0].almost_count == 1
    assert candidate.near_fit.required_extra_width_m == pytest.approx(.05)
    assert candidate.near_fit.occupied_overlap_ratio == pytest.approx(.05/.75)
    assert candidate.near_fit.movement_status == "NOT_COMPUTED"
    target = Polygon([(p.x_m, p.y_m) for p in candidate.near_fit.target_polygon_metric])
    assert target.area == pytest.approx(.75*1.9)


@pytest.mark.parametrize("case", ["occlusion", "uncertainty", "no_evidence", "outside_roi", "too_much_overlap", "too_much_width"])
def test_yellow_never_overrides_uncertainty_visibility_roi_or_large_conflicts(case):
    analysis = scene(.65 if case == "too_much_overlap" else .64 if case == "too_much_width" else .70, 1.9, uncertain=case == "uncertainty")
    if case == "outside_roi":
        analysis["physical_map"]["parking_roi"] = _geometry(box(1, 0, 1.7, 1.9))
    result = evaluate_gap_geometry(analysis, INVERSE, [box(.1, 0, .17, .19)] if case == "occlusion" else [],
        evidence_count=0 if case == "no_evidence" else 1,
        continuous_gaps=True, slot_width_m=.75, near_fit_advisories=True)
    assert result.almost_count == 0
    assert result.green_count == 0
    assert all(item.near_fit is None for item in result.candidates)


def test_yellow_uses_target_plus_margin_and_never_lists_compatible_families():
    from app.services.motorcycle_reference_sizes import load_rules
    from app.services.segmentation_gap_service import recommend_families_by_width

    result = evaluate_gap_geometry(scene(.73, 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.70, clearance_margin_m=.05, near_fit_advisories=True)
    assert result.candidates[0].near_fit.required_extra_width_m == pytest.approx(.02)
    recommend_families_by_width(result, load_rules())
    assert result.candidates[0].compatible_families == []


def test_yellow_target_follows_rotated_row_geometry():
    from app.services.parking_analysis_service import _geometry_to_shapely

    analysis = scene(.70, 1.9)
    row = rotate(_geometry_to_shapely(analysis["physical_map"]["parking_roi"]), 27, origin=(0, 0))
    analysis["physical_map"]["parking_roi"] = _geometry(row)
    analysis["physical_map"]["rows"][0]["polygon"] = _geometry(row)["polygons"][0][0]
    occupied = rotate(_geometry_to_shapely(analysis["detections"][0]["canonical_footprint"]), 27, origin=(0, 0))
    analysis["detections"][0]["canonical_footprint"] = _geometry(occupied)
    result = evaluate_gap_geometry(analysis, [[.1, 0, .2], [0, .1, .2], [0, 0, 1]], [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, near_fit_advisories=True)
    assert result.almost_count == 1
    target = Polygon([(p.x_m, p.y_m) for p in result.candidates[0].near_fit.target_polygon_metric])
    assert row.buffer(1e-7).covers(target)
    assert target.area == pytest.approx(.75*1.9)


def test_width_check_is_separate_from_uncertain_state_and_includes_margin():
    hidden = evaluate_gap_geometry(scene(.82, 1.9), INVERSE, [box(.1, 0, .182, .19)],
        evidence_count=1, continuous_gaps=True, slot_width_m=.75, clearance_margin_m=.05)
    assert hidden.candidates[0].width_check == "SUFFICIENT"
    assert hidden.candidates[0].state == "UNKNOWN"
    assert hidden.green_count == 0
    assert hidden.unknown_count == 1
    assert "GROUND_MAY_BE_OCCLUDED" in hidden.candidates[0].reasons
    narrow = evaluate_gap_geometry(scene(.79, 1.9), INVERSE, [box(.1, 0, .179, .19)],
        evidence_count=1, continuous_gaps=True, slot_width_m=.75, clearance_margin_m=.05)
    assert narrow.candidates[0].width_check == "INSUFFICIENT"
    assert narrow.candidates[0].state == "UNKNOWN"
    assert narrow.green_count == 0


def test_continuous_interval_keeps_full_width_and_preserves_local_uncertainty():
    analysis = scene(6., 1.9, uncertain=True)
    analysis["detections"] = [
        {"detection_id": "detection_1", "canonical_footprint": _geometry(box(0, 0, 1, 1.9)),
         "transform_valid": True, "metric_ground_point": {"x_m": .5, "y_m": 0},
         "reference_size": {"width_m": 1., "length_m": 1.9}},
        {"detection_id": "detection_2", "canonical_footprint": _geometry(box(7, 0, 8, 1.9))}]
    analysis["uncertainty"]["rows"][0].update(reasons=["AMBIGUOUS_ROW_ASSIGNMENT"], affected_detection_ids=["detection_1"])
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True,
        slot_width_m=.75, localize_row_uncertainty=True)
    assert result.green_count == 0
    assert result.unknown_count == 1
    assert len(result.candidates) == 1
    assert result.candidates[0].gap_width_m == pytest.approx(6.)
    assert result.candidates[0].width_check == "SUFFICIENT"
    assert result.uncertainty_regions[0].detection_id == "detection_1"
    assert result.rows[0].uncertainty_scope == "LOCAL_REFERENCE_ENVELOPE"
    envelope = Polygon([(p.x_m, p.y_m) for p in result.uncertainty_regions[0].geometry.polygons[0][0]])
    for angle in (0, 45, 90, 135, 180):
        assert envelope.covers(rotate(box(0, 0, 1, 1.9), angle, origin=(.5, 0)))
    for candidate in result.candidates:
        if candidate.state == "UNKNOWN":
            assert candidate.uncertain_detection_ids == ["detection_1"]
            assert "LOCAL_ROW_UNCERTAINTY" in candidate.reasons
    assert evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=0, continuous_gaps=True,
        slot_width_m=.75, localize_row_uncertainty=True).green_count == 0
    analysis["uncertainty"]["validation"] = False
    assert evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True,
        slot_width_m=.75, localize_row_uncertainty=True).green_count == 0
    analysis["uncertainty"]["validation"] = True
    analysis["detections"][0]["transform_valid"] = False
    unbounded = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True,
        slot_width_m=.75, localize_row_uncertainty=True)
    assert unbounded.green_count == 0
    assert "ROW_UNCERTAIN" in unbounded.candidates[0].reasons
    analysis["detections"][0]["transform_valid"] = True
    analysis["uncertainty"]["rows"][0]["reasons"] = ["OTHER_UNKNOWN_CAUSE"]
    assert evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True,
        slot_width_m=.75, localize_row_uncertainty=True).green_count == 0


def test_continuous_gaps_keep_sub_metre_widths_and_compare_vehicle_with_margin():
    result = evaluate_gap_geometry(scene(.82, 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, clearance_margin_m=.05)
    assert result.evaluation_mode == "CONTINUOUS_GAPS"
    assert result.green_count == 1
    assert len(result.candidates) == 1
    assert result.candidates[0].gap_width_m == pytest.approx(.82)
    assert result.candidates[0].slot_length_m == pytest.approx(1.9)
    assert result.candidates[0].state == "WIDTH_SUFFICIENT"
    assert result.clearance_margin_m == pytest.approx(.05)
    narrow = evaluate_gap_geometry(scene(.79, 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.75, clearance_margin_m=.05)
    assert len(narrow.candidates) == 1
    assert narrow.candidates[0].state == "INSUFFICIENT_WIDTH"
    whole = evaluate_gap_geometry(scene(6., 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.75)
    assert len(whole.candidates) == 1
    assert whole.candidates[0].gap_width_m == pytest.approx(6.)


def test_continuous_gaps_preserve_uncertainty_details_occlusion_and_roi_gates():
    analysis = scene(.82, 1.9, uncertain=True)
    analysis["uncertainty"]["rows"][0].update(reasons=["AMBIGUOUS_ROW_ASSIGNMENT"], affected_detection_ids=["detection_2"])
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, continuous_gaps=True, slot_width_m=.75)
    assert result.green_count == 0
    assert result.candidates[0].state == "UNKNOWN"
    assert "AMBIGUOUS_ROW_ASSIGNMENT" in result.candidates[0].reasons
    assert result.rows[0].affected_detection_ids == ["detection_2"]
    clear = scene(.82, 1.9)
    hidden = evaluate_gap_geometry(clear, INVERSE, [box(.1, 0, .182, .19)], evidence_count=1, continuous_gaps=True, slot_width_m=.75)
    assert hidden.green_count == 0
    assert "GROUND_MAY_BE_OCCLUDED" in hidden.candidates[0].reasons
    clear["physical_map"]["parking_roi"] = _geometry(box(0, 0, 1.5, 1.9))
    outside = evaluate_gap_geometry(clear, INVERSE, [], evidence_count=1, continuous_gaps=True, slot_width_m=.75)
    assert outside.green_count == 0
    assert "FOOTPRINT_NOT_PROVEN" in outside.candidates[0].reasons


def test_continuous_gaps_never_merge_across_an_occupied_vehicle_band():
    analysis = scene(6., 1.9)
    analysis["detections"] = [{"canonical_footprint": _geometry(
        box(0, 0, 1, 1.9).union(box(3, 0, 4, 1.9)).union(box(7, 0, 8, 1.9)))}]
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.66)
    assert len(result.candidates) == 2
    assert sorted(item.gap_width_m for item in result.candidates) == pytest.approx([2., 3.])
    assert all(item.state == "WIDTH_SUFFICIENT" for item in result.candidates)


def test_incoming_width_can_cross_one_metre_visual_grid():
    result = evaluate_gap_geometry(scene(6., 1.9), INVERSE, [], evidence_count=1, virtual_slots=True, slot_width_m=1.2)
    assert len(result.candidates) == 5
    assert result.green_count == 5
    assert result.target_width_m == pytest.approx(1.2)
    for candidate in result.candidates:
        shape = Polygon([(p.x_m, p.y_m) for p in candidate.polygon_metric])
        assert shape.area == pytest.approx(1.2*1.9)
        assert candidate.gap_width_m == pytest.approx(1.2)
    assert len(evaluate_gap_geometry(scene(1.19, 1.9), INVERSE, [], evidence_count=1, virtual_slots=True, slot_width_m=1.2).candidates) == 0


def test_six_metre_gap_produces_six_independent_one_by_two_slots():
    result = evaluate_gap_geometry(scene(6., 2.), INVERSE, [box(.101, 0, .12, .2)], evidence_count=1, virtual_slots=True)
    assert result.evaluation_mode == "VIRTUAL_SLOTS"
    assert result.target_width_m == 1.
    assert result.target_length_m is None
    assert len(result.candidates) == 6
    assert result.green_count == 5
    assert result.unknown_count == 1
    shapes = [Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]) for item in result.candidates]
    for index, shape in enumerate(shapes):
        assert shape.area == pytest.approx(2.)
        assert result.candidates[index].gap_width_m == pytest.approx(1.)
        assert all(shape.intersection(other).area < 1e-8 for other in shapes[:index])


def test_virtual_slots_follow_row_depth_and_do_not_round_up():
    result = evaluate_gap_geometry(scene(6.99, 1.9), INVERSE, [], evidence_count=1, virtual_slots=True)
    assert len(result.candidates) == 6
    assert result.green_count == 6
    assert all(item.slot_length_m == pytest.approx(1.9) for item in result.candidates)
    assert all(Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]).area == pytest.approx(1.9) for item in result.candidates)
    assert all(item.source_gap_width_m == pytest.approx(6.99) for item in result.candidates)


def test_virtual_slots_respect_limit_and_keep_deterministic_ids(monkeypatch):
    from app.services import segmentation_gap_service

    monkeypatch.setattr(segmentation_gap_service, "MAX_CANDIDATES", 3)
    first = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    second = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    assert len(first.candidates) == 3
    assert first.truncated
    assert first == second
    assert all(item.slot_length_m == pytest.approx(1.46) for item in first.candidates)


def test_family_recommendations_use_exact_reference_width_and_only_green_gaps():
    from app.services.motorcycle_reference_sizes import ReferenceSizeRules
    from app.services.segmentation_gap_service import recommend_families_by_width

    rules = ReferenceSizeRules.model_validate({"schema_version": 1, "min_score": 0.,
        "fallback": {"width_m": .66, "length_m": 2., "basis": "fallback"},
        "classes": {name: {"width_m": width, "length_m": 3., "basis": "test reference"}
            for name, width in [("wave", .715), ("pcx", .742)]}})
    gap = evaluate_gap_geometry(scene(.73, 1.), INVERSE, [], evidence_count=1, width_only=True)
    recommend_families_by_width(gap, rules)
    assert [item.family for item in gap.candidates[0].compatible_families] == ["wave"]
    assert gap.candidates[0].compatible_families[0].width_clearance_m == pytest.approx(.015)
    assert gap.candidates[0].compatible_families[0].basis == "test reference"
    exact = evaluate_gap_geometry(scene(.742, 1.), INVERSE, [], evidence_count=1, width_only=True)
    recommend_families_by_width(exact, rules)
    assert [item.family for item in exact.candidates[0].compatible_families] == ["wave", "pcx"]
    assert exact.candidates[0].compatible_families[1].width_clearance_m == pytest.approx(0)
    hidden = evaluate_gap_geometry(scene(.8, 1.), INVERSE, [box(.1, 0, .18, .1)], evidence_count=1, width_only=True)
    recommend_families_by_width(hidden, rules)
    assert hidden.candidates[0].compatible_families == []
    rules.classes["pcx"] = rules.classes["pcx"].model_copy(update={"width_m": 1.01})
    slots = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    recommend_families_by_width(slots, rules)
    assert all([item.family for item in slot.compatible_families] == ["wave"] for slot in slots.candidates)
    rules.classes["pcx"] = rules.classes["pcx"].model_copy(update={"width_m": .742})
    continuous = evaluate_gap_geometry(scene(.75, 1.9), INVERSE, [], evidence_count=1,
        continuous_gaps=True, slot_width_m=.70, clearance_margin_m=.02)
    recommend_families_by_width(continuous, rules)
    assert [item.family for item in continuous.candidates[0].compatible_families] == ["wave"]


def test_full_vehicle_fit_respects_rotated_obstacles_and_roi_holes():
    row = Polygon([(0, 0), (8, 0), (8, 3), (0, 3)])
    roi = row.difference(box(4, .5, 4.3, 1.5))
    occupied = rotate(box(1, .5, 1.8, 2.5), 20, origin=(1.4, 1.5))
    row, roi, occupied = [rotate(shape, 27, origin=(0, 0)) for shape in (row, roi, occupied)]
    free = roi.difference(occupied)
    rows = [("row_1", row)]
    analysis = {"physical_map": {"parking_roi": _geometry(roi), "rows": [{"row_id": "row_1", "polygon": _geometry(row)["polygons"][0][0]}]},
        "detections": [{"canonical_footprint": _geometry(occupied)}],
        "capacity": calculate_capacity(rows, {"row_1": free}, fit_rows(rows, {"row_1": free})),
        "uncertainty": {"validation": True, "rows": [{"row_id": "row_1", "status": "CLEAR"}]}}
    result = evaluate_gap_geometry(analysis, [[.04, 0, .4], [0, .04, .4], [0, 0, 1]], [], evidence_count=1)
    assert result.green_count > 0
    for candidate in result.candidates:
        if candidate.state == "FIT":
            shape = Polygon([(p.x_m, p.y_m) for p in candidate.polygon_metric])
            assert roi.buffer(1e-7).covers(shape)
            assert shape.intersection(occupied).area <= 1e-7
            assert shape.area == pytest.approx(.66 * 2.)


def test_all_width_gaps_report_sufficient_narrow_and_occluded_states():
    narrow = evaluate_gap_geometry(scene(.65, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert len(narrow.candidates) == 1
    assert narrow.candidates[0].state == "INSUFFICIENT_WIDTH"
    assert narrow.narrow_count == 1
    assert narrow.green_count == 0
    assert narrow.candidates[0].gap_width_m == pytest.approx(.65)
    blocked = evaluate_gap_geometry(scene(.65, 1.), INVERSE, [box(.1, 0, .165, .1)], evidence_count=1, width_only=True)
    assert blocked.candidates[0].state == "UNKNOWN"
    assert blocked.narrow_count == 0
    assert "GROUND_MAY_BE_OCCLUDED" in blocked.candidates[0].reasons
    enough = evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert enough.candidates[0].state == "WIDTH_SUFFICIENT"


def test_width_measurement_is_local_to_row_midline_and_layers_clip_to_roi():
    analysis = scene(.8, 2.)
    # A bike at the back blocks the old full-depth corridor, but not the midline.
    analysis["detections"].append({"canonical_footprint": _geometry(box(1, 1.5, 1.8, 2.))})
    analysis["detections"].append({"canonical_footprint": _geometry(box(20, 20, 21, 22))})
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, width_only=True, primary_count=1)
    assert result.green_count == 1
    assert result.candidates[0].gap_width_m == pytest.approx(.8)
    assert result.candidates[0].width_line_metric[0].y_m == pytest.approx(1.)
    assert result.occupied_layers[0].source == "PRIMARY"
    assert result.occupied_layers[1].source == "SEGMENTATION"
    assert result.occupied_layers[2].roi_geometry.polygons == []


def test_top_down_uses_same_metric_geometry_and_preserves_unknown():
    result = evaluate_gap_geometry(scene(.8, 1.), INVERSE, [box(.1, 0, .18, .1)], evidence_count=1, width_only=True)
    assert result.parking_roi_metric.polygons[0][0][1].x_m == pytest.approx(2.8)
    assert len(result.occupied_metric.polygons) == 2
    assert result.rows[0].polygon_metric[1].x_m == pytest.approx(2.8)
    candidate = result.candidates[0]
    assert candidate.state == "UNKNOWN"
    assert candidate.polygon_metric
    assert candidate.width_line_metric[1].x_m - candidate.width_line_metric[0].x_m == pytest.approx(.8)
    assert candidate.label_metric is not None


def test_width_only_accepts_short_gap_without_claiming_full_vehicle_fit():
    result = evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert result.evaluation_mode == "WIDTH_ONLY"
    assert result.green_count == 1
    assert result.candidates[0].state == "WIDTH_SUFFICIENT"
    assert result.candidates[0].gap_width_m == pytest.approx(.66)
    assert evaluate_gap_geometry(scene(.65, 1.), INVERSE, [], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1.), INVERSE, [box(.1, 0, .166, .1)], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1., uncertain=True), INVERSE, [], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=0, width_only=True).green_count == 0
    outside_roi = scene(.66, 1.)
    outside_roi["physical_map"]["parking_roi"] = _geometry(box(0, 0, .5, 1))
    assert evaluate_gap_geometry(outside_roi, INVERSE, [], evidence_count=1, width_only=True).green_count == 0


def test_exact_standard_width_fits_and_reports_metric_gap():
    result = evaluate_gap_geometry(scene(), INVERSE, [], evidence_count=1)
    assert result.green_count >= 1
    candidate = next(item for item in result.candidates if item.state == "FIT")
    assert candidate.gap_width_m == pytest.approx(.66)
    assert candidate.nearest_clearance_m == pytest.approx(0)
    assert candidate.width_line_image and candidate.polygon_image
    assert result.rows[0].polygon_image
    assert result.rows[0].polygon_image[1].x == pytest.approx(.266)
    assert result.rows[0].label_image


@pytest.mark.parametrize("width,depth", [(.65, 2.), (.8, 1.99)])
def test_narrow_or_short_space_never_turns_green(width, depth):
    result = evaluate_gap_geometry(scene(width, depth), INVERSE, [], evidence_count=1)
    assert result.green_count == 0
    assert result.measured_gaps
    gap = result.measured_gaps[0]
    assert gap.width_m == pytest.approx(width)
    assert gap.depth_m == pytest.approx(depth)
    assert gap.state in {"INSUFFICIENT_WIDTH", "INSUFFICIENT_DEPTH"}


def test_occlusion_uncertainty_no_evidence_or_bad_projection_never_turns_green():
    assert evaluate_gap_geometry(scene(), INVERSE, [box(.1, 0, .166, .2)], evidence_count=1).green_count == 0
    assert evaluate_gap_geometry(scene(uncertain=True), INVERSE, [], evidence_count=1).green_count == 0
    assert evaluate_gap_geometry(scene(), INVERSE, [], evidence_count=0).green_count == 0
    assert evaluate_gap_geometry(scene(), [[0, 0, 0]] * 3, [], evidence_count=1).green_count == 0
    unsafe = scene()
    unsafe["physical_map"]["parking_roi"] = _geometry(box(0, 0, .5, 2))
    assert evaluate_gap_geometry(unsafe, INVERSE, [], evidence_count=1).green_count == 0


def test_saved_calibration_uses_only_segmentation_with_mask_fallback(tmp_path, monkeypatch):
    from app.models import DetectionResponse, GroundPlaneCalibration, ParkingCalibration
    from app.services.ground_plane_homography_service import (
        GroundPlaneHomographyService,
    )
    from app.services.motorcycle_reference_sizes import ReferenceDimensions
    from app.services.parking_analysis_service import ParkingAnalysisService
    from app.services.segmentation_experiment_service import (
        SegmentationExperimentResult,
    )
    from app.services.segmentation_gap_service import analyze_segmentation_gaps

    directory = tmp_path / "config"
    directory.mkdir()
    ground = GroundPlaneCalibration.model_validate({"camera_id": "test", "reference_image": {"width": 100, "height": 100}, "coordinate_system": {"unit": "meter"},
        "control_points": [{"id": f"p{i}", "image_x": x, "image_y": y, "ground_x_m": x*10, "ground_y_m": y*10, "provenance": "MEASURED"} for i, (x, y) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1), (.5, .5)])],
        "measured_rows": {"row_1": {"length_m": 8, "width_m": 2, "provenance": "MEASURED"}}})
    roi = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .9}, {"x": .1, "y": .9}]
    row = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .3}, {"x": .1, "y": .3}]
    parking = ParkingCalibration.model_validate({"camera_id": "test", "reference_image": {"width": 100, "height": 100}, "parking_roi": {"polygon": roi}, "rows": [{"id": "row_1", "name": "row", "polygon": row}]})
    ground_path = directory / "ground_plane_calibration.json"
    ground_path.write_text(ground.model_dump_json())
    (directory / "parking_calibration.json").write_text(parking.model_dump_json())
    GroundPlaneHomographyService(directory).calculate(ground, parking)
    service = ParkingAnalysisService()
    service.root = tmp_path
    primary = DetectionResponse(image_width=100, image_height=100, model={"name": "test"}, inference={"imgsz": 960, "confidence_threshold": .25, "nms_iou": .5, "processing_time_ms": 1},
        detections=[{"class_id": 0, "class_name": "motorcycle", "confidence": .9, "bbox": {"x": .3, "y": .05, "width": .05, "height": .1}}])
    segmentation = SegmentationExperimentResult(model="seg", image_width=100, image_height=100, imgsz=960, processing_time_ms=1,
        detections=[{"confidence": .9, "bbox": {"x": .7, "y": .1, "width": .05, "height": .05}}])
    reference = [ReferenceDimensions(width_m=.9, length_m=2.3, basis="known reference")]
    result = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference)
    assert result.status == "EXPERIMENTAL"
    assert result.row_owned_references is True
    assert result.evaluation_mode == "CONTINUOUS_GAPS"
    assert result.access_status == "NOT_EVALUATED"
    assert result.calibration_source == "MEASURED"
    assert result.candidates
    assert result.orientation_display_only is True
    assert len(result.orientation_hypotheses) == 1
    assert result.orientation_hypotheses[0].image_orientation == "AMBIGUOUS_IMAGE"
    assert all(layer.source == "SEGMENTATION" for layer in result.occupied_layers)
    no_primary = primary.model_copy(update={"detections": []})
    assert analyze_segmentation_gaps(no_primary, segmentation, service) == result
    # An unselected vehicle's anchor is outside the row, but the default
    # two-metre reference projects into it. It must not reserve row space.
    outside = {"confidence": .9, "bbox": {"x": .3, "y": .02, "width": .05, "height": .03}}
    mixed = segmentation.model_copy(update={"detections": [type(segmentation.detections[0]).model_validate(outside), *segmentation.detections]})
    scoped = analyze_segmentation_gaps(primary, mixed, service)
    assert scoped.status == "EXPERIMENTAL"
    assert scoped.green_count == result.green_count
    assert [(item.gap_width_m, item.state, item.reasons) for item in scoped.candidates] == [
        (item.gap_width_m, item.state, item.reasons) for item in result.candidates]
    assert [layer.detection_id for layer in scoped.occupied_layers] == ["detection_2"]
    assert scoped.excluded_detection_ids == ["detection_1"]
    assert scoped.orientation_hypotheses[0].detection_index == 1
    assert scoped.occupancy_scope == "GROUND_ANCHOR_OR_ROW_MASK"
    # Active operator mode uses the bottom-centre, independent of a broken mask.
    broken_mask = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .3, "y": .25, "width": .05, "height": .04},
        "polygon": [{"x": .3, "y": .25}, {"x": .35, "y": .29}, {"x": .3, "y": .29}, {"x": .35, "y": .25}]})
    distant_mask = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .5, "y": .2, "width": .05, "height": .2},
        "polygon": [{"x": .5, "y": .2}, {"x": .55, "y": .2}, {"x": .55, "y": .4}, {"x": .5, "y": .4}]})
    anchored = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [broken_mask, distant_mask]}),
        service, bottom_edge_assignment=True)
    assert anchored.occupancy_scope == "BOTTOM_EDGE_ANCHOR"
    assert [layer.detection_id for layer in anchored.occupied_layers] == ["detection_1"]
    assert anchored.occupied_layers[0].assigned_row_id == "row_1"
    assert anchored.excluded_detection_ids == ["detection_2"]
    assert [item.reason for item in anchored.detection_row_assignments] == ["ASSIGNED", "TOO_FAR_FROM_EDGE"]
    first_assignment = anchored.detection_row_assignments[0]
    assert first_assignment.nearest_row_id == "row_1"
    assert first_assignment.distance_line_image[0].x == pytest.approx(.325)
    assert first_assignment.distance_line_image[0].y == pytest.approx(.29)
    a, b = first_assignment.distance_line_metric
    assert ((a.x_m-b.x_m)**2+(a.y_m-b.y_m)**2)**.5 == pytest.approx(first_assignment.distance_m)
    # A horizontal vehicle in the aisle is excluded from row ownership, but
    # independently remains visible/measurable in the experimental diagnostics.
    horizontal = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .3, "y": .4, "width": .2, "height": .05}})
    neighbor = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .6, "y": .3, "width": .05, "height": .2}})
    aisle_horizontal = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [horizontal, neighbor]}),
        service, bottom_edge_assignment=True)
    assert aisle_horizontal.occupied_layers == []
    assert len(aisle_horizontal.horizontal_vehicles) == 1
    assert aisle_horizontal.horizontal_vehicles[0].detection_id == "detection_1"
    assert aisle_horizontal.horizontal_vehicles[0].nearest_detection_id == "detection_2"
    assert aisle_horizontal.horizontal_vehicles[0].clearance_m == pytest.approx(.92)
    # A visible bike can straddle the row boundary while its bbox bottom is
    # just outside. A valid mask inside the selected image row keeps it.
    straddling = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .3, "y": .25, "width": .05, "height": .1},
        "polygon": [{"x": .3, "y": .25}, {"x": .35, "y": .25}, {"x": .35, "y": .35}, {"x": .3, "y": .35}]})
    edge_result = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [straddling, *segmentation.detections]}), service)
    assert [layer.detection_id for layer in edge_result.occupied_layers] == ["detection_1", "detection_2"]
    assert edge_result.excluded_detection_ids == []
    point_only = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .3, "y": .11, "width": .05, "height": .05}})
    image_owned = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [point_only, straddling, mixed.detections[0]]}),
        service, image_row_assignment=True)
    assert image_owned.occupancy_scope == "IMAGE_NEAREST_LOWER_EDGE"
    assert [layer.assigned_row_id for layer in image_owned.occupied_layers] == ["row_1", "row_1"]
    assert [layer.row_assignment_source for layer in image_owned.occupied_layers] == ["IMAGE_NEAREST_EDGE", "IMAGE_NEAREST_EDGE"]
    assert image_owned.occupied_layers[0].row_assignment_distance_m > .2
    assert image_owned.excluded_detection_ids == ["detection_3"]
    assert [record.reason for record in image_owned.detection_row_assignments] == [
        "ASSIGNED_BY_NEAREST_IMAGE_EDGE", "ASSIGNED_BY_NEAREST_IMAGE_EDGE", "OUTSIDE_ROI"]
    # Inside ROI but outside every selected row is excluded too.
    aisle = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .3, "y": .32, "width": .05, "height": .03}})
    aisle_result = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [aisle, *segmentation.detections]}), service)
    assert aisle_result.excluded_detection_ids == ["detection_1"]
    assert [(item.gap_width_m, item.state) for item in aisle_result.candidates] == [(item.gap_width_m, item.state) for item in result.candidates]
    # An excluded anchor does not remove its actual camera-view occlusion.
    occluder = type(segmentation.detections[0]).model_validate({"confidence": .9,
        "bbox": {"x": .4, "y": .1, "width": .3, "height": .3}})
    blocked = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [occluder, *segmentation.detections]}), service)
    assert blocked.excluded_detection_ids == ["detection_1"]
    assert [layer.detection_id for layer in blocked.occupied_layers] == ["detection_2"]
    assert any(item.state == "UNKNOWN" and any(e.detection_id == "detection_1" for e in item.occlusion_evidence) for item in blocked.candidates)
    outside_only = analyze_segmentation_gaps(primary, segmentation.model_copy(update={"detections": [aisle]}), service)
    assert outside_only.green_count == 0
    assert outside_only.occupied_layers == []
    assert outside_only.orientation_hypotheses == []
    assert "NO_SEGMENTATION_EVIDENCE_IN_ROI" in outside_only.reasons
    primary_block = box(3.25-.45, 1.5, 3.25+.45, 1.5+2.3)
    assert any(Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]).intersection(primary_block).area > .1 for item in result.candidates)
    for item in result.candidates:
        metric_shape = Polygon([(p.x_m, p.y_m) for p in item.polygon_metric])
        assert metric_shape.area == pytest.approx(item.gap_width_m * item.slot_length_m)
        assert item.state in {"WIDTH_SUFFICIENT", "INSUFFICIENT_WIDTH", "UNKNOWN"}
    assert len(primary.detections) == 1
    from app.services.segmentation_experiment_service import SegmentedMotorcycle

    masked_bike = SegmentedMotorcycle.model_validate({"confidence": .9,
        "bbox": {"x": .4, "y": .1, "width": .3, "height": .05},
        "polygon": [{"x": .65, "y": .1}, {"x": .7, "y": .1}, {"x": .7, "y": .15}]})
    masked = segmentation.model_copy(update={"detections": [masked_bike]})
    visible = analyze_segmentation_gaps(primary, masked, service)
    left = next(item for item in visible.candidates if item.label_metric.x_m < 5)
    assert left.state == "WIDTH_SUFFICIENT"
    assert "GROUND_MAY_BE_OCCLUDED" not in left.reasons
    assert left.occlusion_evidence_available
    assert left.occlusion_evidence == []
    right = next(item for item in visible.candidates if item.label_metric.x_m > 5)
    assert right.state == "UNKNOWN"
    assert len(right.occlusion_evidence) == 1
    evidence = right.occlusion_evidence[0]
    assert evidence.detection_id == "detection_1"
    assert evidence.detection_index == 0
    assert evidence.source_kind == "MASK"
    overlap = Polygon([(p.x, p.y) for p in evidence.overlap_image.polygons[0][0]])
    assert overlap.area == pytest.approx(.05*.05/2)
    projected_gap = Polygon([(p.x, p.y) for p in right.polygon_image])
    assert projected_gap.buffer(1e-10).covers(overlap)
    assert evidence.candidate_overlap_ratio == pytest.approx(overlap.area/projected_gap.area)
    # Missing, self-intersecting, zero-area, and out-of-box masks fall back to box.
    for polygon in [None, [], [{"x": .4, "y": .1}] * 3,
                    [{"x": .4, "y": .1}, {"x": .7, "y": .15}, {"x": .4, "y": .15}, {"x": .7, "y": .1}],
                    [{"x": .8, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .15}]]:
        invalid = SegmentedMotorcycle.model_validate({**masked_bike.model_dump(), "polygon": polygon})
        fallback = analyze_segmentation_gaps(primary, masked.model_copy(update={"detections": [invalid]}), service)
        left_fallback = next(item for item in fallback.candidates if item.label_metric.x_m < 5)
        assert left_fallback.state == "UNKNOWN"
        assert "GROUND_MAY_BE_OCCLUDED" in left_fallback.reasons
        assert left_fallback.occlusion_evidence[0].source_kind == "BBOX_FALLBACK"
    incoming = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference, incoming_width_m=1.2)
    assert incoming.target_width_m == 1.2
    assert incoming.incoming_vehicle.width_m == 1.2
    assert incoming.incoming_vehicle.allocation_width_m == 1.2
    assert incoming.incoming_vehicle.candidates
    assert all(item.gap_width_m > 0 for item in incoming.incoming_vehicle.candidates)
    assert not {item.id for item in incoming.candidates} & {item.id for item in incoming.incoming_vehicle.candidates}
    small = analyze_segmentation_gaps(primary, segmentation, service, incoming_width_m=.75)
    assert small.incoming_vehicle.allocation_width_m == .75
    padded = analyze_segmentation_gaps(primary, segmentation, service, incoming_width_m=.75, clearance_margin_m=.1)
    assert padded.incoming_vehicle.allocation_width_m == pytest.approx(.85)
    shaped = analyze_segmentation_gaps(primary, masked, service, incoming_width_m=.75,
        clearance_margin_m=.1, visible_free_shapes=True)
    assert shaped.evaluation_mode == "VISIBLE_FREE_SHAPES"
    assert shaped.width_measurement == "VISIBLE_PATCH_CROSS_SECTION"
    assert shaped.target_width_m == .75
    assert shaped.clearance_margin_m == .1
    assert shaped.green_count > 0
    assert shaped.unknown_count > 0
    assert shaped.incoming_vehicle.recommended_count == shaped.green_count
    assert all(item.geometry_metric is not None for item in shaped.candidates)
    assert all(item.slot_length_m is None for item in shaped.candidates)
    assert all(item.visibility == "VISIBLE" and item.gap_width_m >= .85-1e-6
        for item in shaped.candidates if item.state == "WIDTH_SUFFICIENT")
    assert analyze_segmentation_gaps(no_primary, masked, service, incoming_width_m=.75,
        clearance_margin_m=.1, visible_free_shapes=True) == shaped
    from app.services import motorcycle_reference_sizes

    broken_rules = tmp_path / "broken_sizes.json"
    broken_rules.write_text('{"schema_version": 999}', encoding="utf-8")
    monkeypatch.setattr(motorcycle_reference_sizes, "RULES_PATH", broken_rules)
    unavailable = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference)
    assert unavailable.status == "EXPERIMENTAL"
    assert unavailable.family_recommendation_error
    assert unavailable.green_count == result.green_count
    assert all(not item.compatible_families for item in unavailable.candidates)
    wrong_frame = segmentation.model_copy(update={"image_width": 200})
    assert analyze_segmentation_gaps(primary, wrong_frame, service).status == "CALIBRATION_REQUIRED"
    ground.control_points[0].ground_x_m = .1
    ground_path.write_text(ground.model_dump_json())
    stale = analyze_segmentation_gaps(primary, segmentation, service)
    assert stale.status == "CALIBRATION_REQUIRED"
    assert stale.green_count == 0
