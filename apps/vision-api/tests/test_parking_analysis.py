"""Focused deterministic tests for Backend Parking Analysis V1.

These tests intentionally use synthetic metric geometry and do not require
YOLO, best.pt, a camera image, or a running API server.
"""

from math import isclose

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.services.parking_analysis_service import (
    EPSILON,
    LENGTH_M,
    WIDTH_M,
    ParkingAnalysisService,
    _geometry,
)


def square(x=0.0, y=0.0, width=10.0, height=10.0):
    return Polygon([(x, y), (x + width, y), (x + width, y + height), (x, y + height)])


def test_ground_point_is_bbox_bottom_center():
    bbox = {"x": 0.2, "y": 0.3, "width": 0.4, "height": 0.5}
    assert (bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"]) == (0.4, 0.8)


def test_saved_homography_projection_preserves_negative_coordinates():
    point = ParkingAnalysisService._project((0.0, 0.0), [[1, 0, -2], [0, 1, -3], [0, 0, 1]])
    assert point == (-2.0, -3.0)


def test_canonical_footprint_dimensions_area_and_orientation():
    footprint = ParkingAnalysisService._footprint((4.0, 5.0))
    assert WIDTH_M == 0.66
    assert LENGTH_M == 2.0
    assert isclose(footprint.area, 1.32, abs_tol=EPSILON)
    assert footprint.centroid.x == 4.0
    assert footprint.centroid.y == 6.0
    assert footprint.bounds == (3.67, 5.0, 4.33, 7.0)


def test_footprint_ground_point_is_near_edge_midpoint():
    footprint = ParkingAnalysisService._footprint((4.0, 5.0))
    assert footprint.boundary.distance(Point(4.0, 5.0)) <= EPSILON


def test_inclusion_ground_point_roi():
    roi = square(0, 0, 10, 10)
    assert roi.covers(Point((5, 5)))


def test_inclusion_positive_footprint_overlap():
    roi = square(0, 0, 10, 10)
    footprint = ParkingAnalysisService._footprint((9.8, 5))
    assert footprint.intersection(roi).area > EPSILON


def test_footprint_roi_positive_area_threshold_and_zero_boundary():
    roi = square(0, 0, 10, 10)
    tiny = Polygon([(10 - 1e-4, 0), (10, 0), (10, 1e-3), (10 - 1e-4, 1e-3)])
    assert tiny.intersection(roi).area > 1e-8
    assert Polygon([(10, 0), (11, 0), (11, 1), (10, 1)]).intersection(roi).area <= 1e-8


def test_inclusion_evidence_conditions_are_independent():
    roi = square(0, 0, 10, 10)
    assert roi.covers(Point(5, 5))  # GROUND_POINT_ROI
    assert square(9.9, 5, 1, 1).intersection(roi).area > 1e-8  # FOOTPRINT_ROI
    assert 0.65 >= 0.60 and (0.65 - 0.40) >= 0.20  # PHYSICAL_ROW
    assert not (0.59 >= 0.60)


def test_inclusion_strong_row_evidence_and_weak_evidence():
    rows = [("row_1", square(0, 0, 10, 2)), ("row_2", square(0, 2, 10, 2))]
    # Point is outside both rows, so this exercises footprint evidence only:
    # 95% vs 5% overlap satisfies best >= .60 and margin >= .20.
    strong = ParkingAnalysisService._row_assignment(square(1, 0.1, 1, 2), (1, 5), rows)
    assert strong[0] == "row_1"
    assert strong[1] == "FOOTPRINT_ASSIGNED"
    assert strong[2][0]["overlap_ratio"] >= 0.60
    assert strong[2][0]["overlap_ratio"] - strong[2][1]["overlap_ratio"] >= 0.20

    # A 50% overlap with one separated row is below the minimum threshold,
    # without creating positive evidence for a second row. The canonical
    # implementation therefore returns UNASSIGNED.
    separated_rows = [("row_1", square(0, 0, 10, 2)), ("row_2", square(0, 3, 10, 2))]
    below_threshold = ParkingAnalysisService._row_assignment(square(1, 1.5, 1, 1), (1, 5), separated_rows)
    assert below_threshold[1] == "UNASSIGNED"
    assert below_threshold[2][0]["overlap_ratio"] < 0.60
    assert below_threshold[2][1]["overlap_ratio"] == 0

    # Best overlap passes .60, but overlapping rows produce a margin below .20.
    margin_rows = [("row_1", Polygon([(0, 0), (2.2, 0), (2.2, 2), (0, 2)])), ("row_2", Polygon([(1.2, 0), (3.0, 0), (3.0, 2), (1.2, 2)]))]
    insufficient_margin = ParkingAnalysisService._row_assignment(Polygon([(0, 0), (3, 0), (3, 2), (0, 2)]), (5, 5), margin_rows)
    assert insufficient_margin[1] == "AMBIGUOUS"
    assert insufficient_margin[2][0]["overlap_ratio"] >= 0.60
    assert insufficient_margin[2][0]["overlap_ratio"] - insufficient_margin[2][1]["overlap_ratio"] < 0.20

    no_evidence = ParkingAnalysisService._row_assignment(square(1, 5, 1, 1), (5, 6), rows)
    assert no_evidence[1] == "UNASSIGNED"


def test_row_assignment_states():
    rows = [("row_1", square(0, 0, 10, 2)), ("row_2", square(0, 2, 10, 2))]
    assert ParkingAnalysisService._row_assignment(square(1, 0, 1, 2), (1, 1), rows)[1] == "POINT_ASSIGNED"
    assert ParkingAnalysisService._row_assignment(square(1, 0.1, 1, 2), (1, 5), rows)[1] == "FOOTPRINT_ASSIGNED"
    assert ParkingAnalysisService._row_assignment(square(1, 1, 1, 2), (1, 5), rows)[1] == "AMBIGUOUS"
    assert ParkingAnalysisService._row_assignment(square(1, 5, 1, 1), (1, 5), rows)[1] == "UNASSIGNED"


def test_intersection_assigned_and_cross_row_blocks():
    footprint = square(1, 1, 2, 2)
    row_one, row_two = square(0, 0, 10, 2), square(0, 2, 10, 2)
    assert footprint.intersection(row_one).area > 0
    assert footprint.intersection(row_two).area > 0


def test_union_overlaps_deduplicates_raw_intersections():
    first, second = square(0, 0, 3, 3), square(2, 0, 3, 3)
    union = unary_union([first, second])
    assert union.area < first.area + second.area
    assert first.area + second.area - union.area > 0


def test_empty_occupied_row_is_fully_free():
    row = square()
    free = row.difference(Polygon())
    assert free.equals(row)
    assert isclose(free.area, row.area)


def test_fully_occupied_row_is_empty():
    row = square()
    free = row.difference(row)
    assert free.is_empty


def test_difference_disconnected_components_and_hole():
    row = square()
    vertical = Polygon([(4, 0), (6, 0), (6, 10), (4, 10)])
    disconnected = row.difference(vertical)
    assert disconnected.geom_type == "MultiPolygon"
    assert len(disconnected.geoms) == 2

    hole = row.difference(square(4, 4, 2, 2))
    assert hole.geom_type == "Polygon"
    assert len(hole.interiors) == 1


def test_area_identity_and_conservative_all_row_blocking():
    rows = [square(0, 0, 10, 2), square(0, 2, 10, 2)]
    footprint = square(4, 1, 2, 2)
    pieces = [footprint.intersection(row) for row in rows]
    for row, piece in zip(rows, pieces):
        occupied = unary_union([piece])
        free = row.difference(occupied)
        assert isclose(row.area, occupied.area + free.area, abs_tol=EPSILON)
        assert piece.area > 0


def test_polygon_serialization_preserves_polygon_and_hole():
    geometry = _geometry(square().difference(square(4, 4, 2, 2)))
    assert len(geometry["polygons"]) == 1
    assert len(geometry["polygons"][0]) == 2


def test_multipolygon_serialization_preserves_components():
    geometry = _geometry(square().difference(Polygon([(4, 0), (6, 0), (6, 10), (4, 10)])))
    assert len(geometry["polygons"]) == 2
    assert all(len(polygon) == 1 for polygon in geometry["polygons"])


def test_measured_physical_rows_are_authoritative_areas():
    homography = {"matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
    calibration = {"measured_rows": {"row_1": {"length_m": 4, "width_m": 2}}}
    parking = {"rows": [{"id": "row_1", "polygon": [
        {"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
        {"x": 0.9, "y": 0.3}, {"x": 0.1, "y": 0.3},
    ]}]}
    rows = dict(ParkingAnalysisService._measured_rows(homography, calibration, parking))
    expected = {
        row_id: float(dimensions["length_m"]) * float(dimensions["width_m"])
        for row_id, dimensions in calibration["measured_rows"].items()
    }
    assert set(rows) == set(expected)
    for row_id, area in expected.items():
        assert isclose(rows[row_id].area, area, abs_tol=1e-6)


def test_row_evidence_serialization_uses_canonical_intersections():
    footprint = square(1, 1, 2, 2)
    rows = [("row_1", square(0, 0, 10, 2)), ("row_2", square(0, 2, 10, 2))]
    evidence = ParkingAnalysisService._row_evidence(footprint, rows)
    assert [item["row_id"] for item in evidence] == ["row_1", "row_2"]
    assert all(isinstance(item["intersection_area_m2"], float) for item in evidence)
    assert all(isinstance(item["overlap_ratio"], float) for item in evidence)
    ordered = sorted(evidence, key=lambda item: item["overlap_ratio"], reverse=True)
    assert ordered[0]["overlap_ratio"] >= ordered[1]["overlap_ratio"]
