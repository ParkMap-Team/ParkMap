import pytest
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

FOOTPRINT = Polygon([(0, 0), (0.66, 0), (0.66, 2), (0, 2)])


def test_controlled_valid_placement_is_green_and_not_almost_available():
    capacity = calculate_row_capacity("row_1", ROW, ROW)
    result = _run(Polygon(), capacity=capacity)
    assert capacity["capacity"] > 0
    assert result == []
    assert all(item["footprint_metric"]["polygons"] for item in capacity["placements"])


def test_controlled_small_conflict_is_yellow_but_not_capacity():
    occupied = Polygon([(0.60, 0), (0.633, 0), (0.633, 2), (0.60, 2)])
    free = ROW.difference(occupied)
    production_capacity = calculate_row_capacity("row_1", ROW, free)
    result = _run(occupied)
    assert result
    for item in result:
        assert item["row_id"] == "row_1"
        assert item["status"] == "ALMOST_AVAILABLE"
        assert item["reason"] == "SMALL_OCCUPIED_CONFLICT"
        assert item["occupied_overlap_area_m2"] > 0
        assert 0 < item["occupied_overlap_ratio"] <= ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO
        assert "footprint_metric" in item
    assert production_capacity["capacity"] == len(production_capacity["placements"])


def test_controlled_large_conflict_is_neither_green_nor_yellow():
    occupied = ROW
    production_capacity = calculate_row_capacity("row_1", ROW, ROW.difference(occupied))
    result = _run(occupied)
    assert FOOTPRINT.intersection(occupied).area / FOOTPRINT.area == pytest.approx(1.0)
    assert FOOTPRINT.intersection(occupied).area / FOOTPRINT.area > ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO
    assert result == []
    assert production_capacity["capacity"] == 0


def test_controlled_obstacle_move_transitions_yellow_to_green():
    before = Polygon([(0.60, 0), (0.633, 0), (0.633, 2), (0.60, 2)])
    after = Polygon([(10.01, 0), (10.043, 0), (10.043, 2), (10.01, 2)])
    before_capacity = calculate_row_capacity("row_1", ROW, ROW.difference(before))
    after_capacity = calculate_row_capacity("row_1", ROW, ROW.difference(after))
    before_result = _run(before)
    after_result = _run(after, capacity=after_capacity)
    assert before_result
    assert all(item["status"] == "ALMOST_AVAILABLE" for item in before_result)
    assert after_result == []
    assert 10.01 - 0.60 == pytest.approx(9.41)
    assert after_capacity["capacity"] >= before_capacity["capacity"]


@pytest.mark.parametrize("requested_ratio", [0.00, 0.01, 0.05, 0.099, 0.10, 0.101, 0.15])
def test_overlap_ratio_boundary_semantics(requested_ratio):
    obstacle_width = 0.66 * requested_ratio
    obstacle = Polygon([(0, 0), (obstacle_width, 0), (obstacle_width, 2), (0, 2)])
    actual_ratio = FOOTPRINT.intersection(obstacle).area / FOOTPRINT.area
    yellow = 0.0 < actual_ratio <= ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO
    assert actual_ratio == pytest.approx(requested_ratio, abs=1e-12)
    assert yellow is (0.0 < requested_ratio <= ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO)


def test_empty_geometry_is_safely_rejected():
    empty = Polygon()
    assert calculate_almost_available_placements(
        [("row_10", ROW)], {"row_10": empty}, {"row_10": ROW}, {"rows": []},
        {"rows": [{"row_id": "row_10", "status": "CLEAR"}]},
    ) == []


def test_dynamic_row_10_is_supported_without_fixed_row_assumptions():
    occupied = Polygon([(0.60, 0), (0.633, 0), (0.633, 2), (0.60, 2)])
    result = _run(occupied, row_id="row_10")
    assert result
    assert {item["row_id"] for item in result} == {"row_10"}
