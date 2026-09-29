from __future__ import annotations

from typing import Any


def calculate_parking_state(capacity: dict[str, Any], uncertainty: dict[str, Any], repacking: dict[str, Any] | None = None) -> dict[str, Any]:
    uncertainty_rows = {row["row_id"]: row for row in uncertainty.get("rows", [])}
    output = []
    valid = bool(uncertainty.get("validation"))
    for source in sorted(capacity.get("rows", []), key=lambda row: row.get("row_id", "")):
        row_id = source.get("row_id")
        cap = source.get("capacity")
        uncertain = uncertainty_rows.get(row_id, {}).get("status")
        repacked = next((item for item in (repacking or {}).get("rows", []) if item.get("row_id") == row_id), {})
        evidence = list(uncertainty_rows.get(row_id, {}).get("affected_detection_ids", []))
        row_valid = isinstance(cap, int) and cap >= 0 and uncertain in {"CLEAR", "UNCERTAIN"}
        if uncertain == "UNCERTAIN":
            state, reason = "UNCERTAIN", "UNCERTAINTY_PRESENT"
        elif uncertain == "CLEAR" and cap > 0:
            state, reason = "AVAILABLE", "POSITIVE_CAPACITY_CLEAR"
        elif uncertain == "CLEAR" and cap == 0:
            if repacked.get("validation") is True and isinstance(repacked.get("repacked_additional_capacity"), int) and repacked["repacked_additional_capacity"] > 0:
                state, reason = "ADJUSTABLE", "REPACKING_PROVES_ADDITIONAL_CAPACITY"
            else:
                state, reason = "UNAVAILABLE", "ZERO_CAPACITY_CLEAR"
        else:
            state, reason, row_valid = "UNCERTAIN", "INVALID_INPUT", False
        row_valid &= (state == "UNCERTAIN" and uncertain == "UNCERTAIN") or (state == "AVAILABLE" and uncertain == "CLEAR" and cap > 0) or (state == "UNAVAILABLE" and uncertain == "CLEAR" and cap == 0) or (state == "ADJUSTABLE" and uncertain == "CLEAR" and cap == 0 and repacked.get("validation") is True and repacked.get("repacked_additional_capacity", 0) > 0)
        valid &= row_valid
        output.append({"row_id": row_id, "state": state, "capacity": cap, "uncertainty": uncertain, "evidence_ids": evidence, "decision_reason": reason, "validation": row_valid})
    return {"rows": output, "validation": valid}
