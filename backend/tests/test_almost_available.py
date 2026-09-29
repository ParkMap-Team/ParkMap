from shapely.geometry import Polygon

from app.services.almost_available_service import (
    ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO,
    calculate_almost_available_placements,
)
from app.services.capacity_service import calculate_row_capacity


ROW = Polygon([(0, 0), (10, 0), (10, 2), (0, 2)])


def _run(occupied, *, row_id="row_1", uncertainty=None, capacity=None):
    free = ROW.difference(occupied)
    return calculate_almost_available_placements(
        [(row_id, ROW)],
        {row_id: occupied},
        {row_id: free},
        capacity or {"rows": [{"row_id": row_id, "capacity": 0, "placements": []}]},
        uncertainty,
    )


def test_zero_overlap_is_not_almost_available():
    assert _run(Polygon()) == []


def test_small_overlap_is_almost_available():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    result = _run(occupied)
    assert result
    assert all(0 < item["occupied_overlap_ratio"] <= ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO for item in result)
    assert all(item["status"] == "ALMOST_AVAILABLE" for item in result)


def test_overlap_above_threshold_is_not_almost_available():
    occupied = Polygon([(0, 0), (0.66, 0), (0.66, 2), (0, 2)])
    assert _run(occupied) == []


def test_uncertain_row_is_not_almost_available():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    uncertainty = {"rows": [{"row_id": "row_1", "status": "UNCERTAIN"}]}
    assert _run(occupied, uncertainty=uncertainty) == []


def test_duplicate_candidates_are_deduplicated():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    result = _run(occupied)
    bounds = [(round(item["footprint_metric"]["polygons"][0][0][0]["x_m"], 6), item["occupied_overlap_ratio"]) for item in result]
    assert len(bounds) == len(set(bounds))


def test_candidate_overlapping_green_witness_is_not_yellow():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    green = {"row_id": "row_1", "capacity": 1, "placements": [{"footprint_metric": {"polygons": [[[{"x_m": 0, "y_m": 0}, {"x_m": 0.66, "y_m": 0}, {"x_m": 0.66, "y_m": 2}, {"x_m": 0, "y_m": 2}]]]}}]}
    assert _run(occupied, capacity={"rows": [green]}) == []


def test_almost_available_does_not_change_capacity():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    free = ROW.difference(occupied)
    before = calculate_row_capacity("row_1", ROW, free)
    _run(occupied, capacity={"rows": [before]})
    after = calculate_row_capacity("row_1", ROW, free)
    assert before == after


def test_sparse_dynamic_row_ids_are_supported():
    occupied = Polygon([(0.60, 0), (0.66, 0), (0.66, 2), (0.60, 2)])
    result = _run(occupied, row_id="row_4")
    assert result and {item["row_id"] for item in result} == {"row_4"}


def test_candidate_outside_physical_row_is_rejected():
    narrow = Polygon([(0, 0), (0.5, 0), (0.5, 2), (0, 2)])
    occupied = Polygon([(0.45, 0), (0.5, 0), (0.5, 2), (0.45, 2)])
    free = narrow.difference(occupied)
    result = calculate_almost_available_placements(
        [("row_8", narrow)], {"row_8": occupied}, {"row_8": free}, {"rows": []}, {"rows": [{"row_id": "row_8", "status": "CLEAR"}]}
    )
    assert result == []
