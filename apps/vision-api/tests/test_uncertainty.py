from shapely.geometry import Polygon

from app.services.uncertainty_service import calculate_uncertainty


def box(x, y, w, h):
    return Polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def item(state, footprint, detection_id="detection_1"):
    return ({"detection_id": detection_id}, footprint, (None, state, []))


def test_ambiguous_affects_only_intersected_rows():
    result = calculate_uncertainty([("row_1", box(0, 0, 2, 2)), ("row_2", box(2, 0, 2, 2))], [item("AMBIGUOUS", box(2.1, 0, .5, 1))])
    assert result["rows"][0]["status"] == "CLEAR"
    assert result["rows"][1]["status"] == "UNCERTAIN"


def test_unassigned_without_intersection_does_not_mark_rows():
    result = calculate_uncertainty([("row_1", box(0, 0, 2, 2))], [item("UNASSIGNED", box(5, 5, 1, 1))])
    assert result["rows"][0]["status"] == "CLEAR"


def test_normal_assignments_do_not_create_uncertainty():
    result = calculate_uncertainty([("row_1", box(0, 0, 2, 2))], [item("POINT_ASSIGNED", box(0, 0, 1, 1)), item("FOOTPRINT_ASSIGNED", box(0, 0, 1, 1), "detection_2")])
    assert result["rows"][0]["status"] == "CLEAR"


def test_evidence_is_deterministic_and_deduplicated():
    result = calculate_uncertainty([("row_1", box(0, 0, 2, 2))], [item("AMBIGUOUS", box(0, 0, 1, 1)), item("AMBIGUOUS", box(0, 0, 1, 1))])
    row = result["rows"][0]
    assert row["affected_detection_ids"] == ["detection_1"]
    assert len(row["evidence"]) == 1
