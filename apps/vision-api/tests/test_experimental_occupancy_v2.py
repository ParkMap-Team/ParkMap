from shapely.geometry import Polygon

from app.services.experimental_occupancy_v2_service import (
    CANONICAL_LENGTH_M,
    calculate_experimental_occupancy_v2,
)


def test_scenarios_are_parameterized_and_unvalidated():
    result = calculate_experimental_occupancy_v2([("row_1", Polygon([(0, 0), (4, 0), (4, 2), (0, 2)]))], {"row_1": Polygon([(0, 0), (4, 0), (4, 2), (0, 2)])}, [])
    assert result["status"] == "EXPERIMENTAL"
    assert result["provenance"] == "EXPERIMENTAL_UNVALIDATED"
    assert result["canonical_envelope"] == {"width_m": 0.8, "length_m": 2.0}
    assert [item["core_width_m"] for item in result["scenarios"]] == [0.40, 0.50, 0.60, 0.65, 0.70, 0.80]
    assert all(item["core_length_m"] == CANONICAL_LENGTH_M for item in result["scenarios"])
    assert next(item for item in result["scenarios"] if item["core_width_m"] == 0.65)["rows"][0]["core_width_m"] == 0.65


def test_empty_row_produces_real_contained_witnesses_deterministically():
    row = Polygon([(0, 0), (4, 0), (4, 2), (0, 2)])
    first = calculate_experimental_occupancy_v2([("row_1", row)], {"row_1": row}, [])
    second = calculate_experimental_occupancy_v2([("row_1", row)], {"row_1": row}, [])
    assert first == second
    for scenario in first["scenarios"]:
        placement = scenario["rows"][0]["placements"][0]
        assert placement["envelope"]["polygons"]
        assert placement["core"]["polygons"]
        assert scenario["rows"][0]["experimental_capacity"] > 0


def test_core_width_changes_occupancy_without_mutating_input():
    row = Polygon([(0, 0), (4, 0), (4, 2), (0, 2)])
    before = row.wkt
    included = [({"detection_id": "d1"}, Polygon([(0, 0), (0.8, 0), (0.8, 2), (0, 2)]), ("row_1", "POINT_ASSIGNED", []))]
    result = calculate_experimental_occupancy_v2([("row_1", row)], {"row_1": row}, included)
    assert row.wkt == before
    assert result["scenarios"][0]["rows"][0]["core_occupied_area_m2"] < result["scenarios"][-1]["rows"][0]["core_occupied_area_m2"]
    for scenario in result["scenarios"]:
        row_result = scenario["rows"][0]
        assert abs(row_result["remaining_area_m2"] - (row.area - row_result["core_occupied_area_m2"])) < 1e-9
        assert row_result["production_free_area_m2"] == row.area
