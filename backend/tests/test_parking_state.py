from app.services.parking_state_service import calculate_parking_state


def state(capacity, uncertainty):
    return calculate_parking_state({"rows": [{"row_id": "row_1", "capacity": capacity}]}, {"rows": [{"row_id": "row_1", "status": uncertainty, "affected_detection_ids": ["d1"] if uncertainty == "UNCERTAIN" else []}], "validation": True})["rows"][0]


def test_decision_table():
    assert state(0, "CLEAR")["state"] == "UNAVAILABLE"
    assert state(1, "CLEAR")["state"] == "AVAILABLE"
    assert state(22, "CLEAR")["state"] == "AVAILABLE"
    assert state(0, "UNCERTAIN")["state"] == "UNCERTAIN"
    assert state(7, "UNCERTAIN")["state"] == "UNCERTAIN"


def test_uncertainty_precedes_capacity_and_preserves_evidence():
    result = state(7, "UNCERTAIN")
    assert result["decision_reason"] == "UNCERTAINTY_PRESENT"
    assert result["evidence_ids"] == ["d1"]


def test_invalid_inputs_fail_validation():
    result = calculate_parking_state({"rows": [{"row_id": "row_1", "capacity": -1}]}, {"rows": [{"row_id": "row_1", "status": "CLEAR"}], "validation": True})
    assert result["validation"] is False
    assert result["rows"][0]["validation"] is False


def test_clear_zero_capacity_with_valid_repacking_is_adjustable():
    result = calculate_parking_state(
        {"rows": [{"row_id": "row_1", "capacity": 0}]},
        {"rows": [{"row_id": "row_1", "status": "CLEAR"}], "validation": True},
        {"rows": [{"row_id": "row_1", "repacked_additional_capacity": 1, "validation": True}], "validation": True},
    )["rows"][0]
    assert result["state"] == "ADJUSTABLE"


def test_uncertain_overrides_repacking():
    repacking = {"rows": [{"row_id": "row_1", "repacked_additional_capacity": 10, "validation": True}], "validation": True}
    result = calculate_parking_state({"rows": [{"row_id": "row_1", "capacity": 5}]}, {"rows": [{"row_id": "row_1", "status": "UNCERTAIN"}], "validation": True}, repacking)
    assert result["rows"][0]["state"] == "UNCERTAIN"
