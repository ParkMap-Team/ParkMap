from app.services.rearrangement_plan_service import build_rearrangement_plan


def test_adjustable_rearrange_first_produces_ready_plan():
    result = build_rearrangement_plan(
        {"rows": [{"row_id": "row_1", "capacity": 0}]},
        {"rows": [{"row_id": "row_1", "state": "ADJUSTABLE"}]},
        {"rows": [{"row_id": "row_1", "status": "REARRANGE_FIRST", "recommended_placement": {"source": "REPACKING_WITNESS"}}]},
        {"rows": [{"row_id": "row_1", "validation": True, "optimality": "PROVEN", "repacked_additional_capacity": 1, "witness_placements": [{"id": "w1"}]}]},
    )["plans"][0]
    assert result["status"] == "READY"
    assert result["target_arrangement"]["placement_count"] == 1
    assert result["movement_assignment"]["status"] == "NOT_COMPUTED"


def test_uncertain_and_available_are_not_applicable():
    repacking = {"rows": [{"row_id": "row_1", "validation": True, "optimality": "PROVEN", "repacked_additional_capacity": 2, "witness_placements": [{}]}]}
    for state, recommendation in (("UNCERTAIN", "NOT_RECOMMENDED"), ("AVAILABLE", "PARK_HERE")):
        result = build_rearrangement_plan({"rows": [{"row_id": "row_1", "capacity": 1}]}, {"rows": [{"row_id": "row_1", "state": state}]}, {"rows": [{"row_id": "row_1", "status": recommendation}]}, repacking)["plans"][0]
        assert result["status"] == "NOT_APPLICABLE"


def test_adjustable_without_valid_witness_is_invalid():
    result = build_rearrangement_plan({"rows": [{"row_id": "row_1", "capacity": 0}]}, {"rows": [{"row_id": "row_1", "state": "ADJUSTABLE"}]}, {"rows": [{"row_id": "row_1", "status": "REARRANGE_FIRST", "recommended_placement": {"source": "REPACKING_WITNESS"}}]}, {"rows": [{"row_id": "row_1", "validation": False, "optimality": "NOT_PROVEN", "repacked_additional_capacity": 1, "witness_placements": []}]})["plans"][0]
    assert result["status"] == "INVALID"
