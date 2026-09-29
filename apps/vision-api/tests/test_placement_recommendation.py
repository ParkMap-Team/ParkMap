from app.services.placement_recommendation_service import calculate_recommendations


def capacity(value, placements=True):
    return {"rows": [{"row_id": "row_1", "capacity": value, "placements": [{"anchor_metric": {"x_m": 0, "y_m": 0}, "footprint_metric": {"polygons": [[[]]]}}] if placements else [], "validation": {"valid": True}}]}


def states(status):
    return {"rows": [{"row_id": "row_1", "state": status, "validation": True, "evidence_ids": []}], "validation": True}


def test_available_uses_first_capacity_witness():
    result = calculate_recommendations(capacity(1), states("AVAILABLE"))["rows"][0]
    assert result["status"] == "PARK_HERE"
    assert result["recommended_placement"]["source"] == "CURRENT_CAPACITY_WITNESS"


def test_available_without_witness_is_invalid():
    result = calculate_recommendations(capacity(1, False), states("AVAILABLE"))["rows"][0]
    assert result["status"] == "INVALID"
    assert result["validation"] is False


def test_uncertain_with_capacity_is_not_recommended():
    result = calculate_recommendations(capacity(7), states("UNCERTAIN"))["rows"][0]
    assert result["status"] == "NOT_RECOMMENDED"
    assert result["validation"] is True


def test_adjustable_with_proven_repacking_is_rearrange_first():
    result = calculate_recommendations(
        capacity(0, False),
        states("ADJUSTABLE"),
        {"rows": [{"row_id": "row_1", "repacked_additional_capacity": 1, "optimality": "PROVEN", "witness_placements": [{"anchor_metric": {"x_m": 1, "y_m": 1}}], "validation": True}]},
    )["rows"][0]
    assert result["status"] == "REARRANGE_FIRST"
    assert result["recommended_placement"]["source"] == "REPACKING_WITNESS"


def test_adjustable_without_proof_is_not_recommended():
    result = calculate_recommendations(capacity(0, False), states("ADJUSTABLE"), {"rows": [{"row_id": "row_1", "repacked_additional_capacity": 1, "optimality": "NOT_PROVEN", "witness_placements": [{}], "validation": True}]})["rows"][0]
    assert result["status"] == "NOT_RECOMMENDED"
