from __future__ import annotations

from typing import Any

from app.services.virtual_fitting_service import LENGTH_M, WIDTH_M


def calculate_recommendations(capacity: dict[str, Any], parking_state: dict[str, Any], repacking: dict[str, Any] | None = None) -> dict[str, Any]:
    states = {item["row_id"]: item for item in parking_state.get("rows", [])}
    results = []
    for row in sorted(capacity.get("rows", []), key=lambda item: item.get("row_id", "")):
        row_id = row["row_id"]
        state = states.get(row_id, {})
        capacity_valid = row.get("validation") is True or (isinstance(row.get("validation"), dict) and row["validation"].get("valid") is True)
        state_valid = state.get("validation") is True
        eligible = state.get("state") == "AVAILABLE" and state_valid and capacity_valid and isinstance(row.get("capacity"), int) and row["capacity"] > 0 and bool(row.get("placements"))
        available_positive = state.get("state") == "AVAILABLE" and state.get("validation") is True and isinstance(row.get("capacity"), int) and row["capacity"] > 0
        if available_positive and not eligible:
            results.append({"row_id": row_id, "status": "INVALID", "reason": "MISSING_CURRENT_CAPACITY_WITNESS", "parking_state": state.get("state"), "current_capacity": row.get("capacity", 0), "recommended_placement": None, "validation": False})
            continue
        if state.get("state") == "ADJUSTABLE":
            repacked = next((item for item in (repacking or {}).get("rows", []) if item.get("row_id") == row_id), {})
            witnesses = repacked.get("witness_placements")
            valid = state_valid and row.get("capacity") == 0 and repacked.get("validation") is True and repacked.get("optimality") == "PROVEN" and isinstance(repacked.get("repacked_additional_capacity"), int) and repacked["repacked_additional_capacity"] > 0 and isinstance(witnesses, list) and len(witnesses) > 0
            if valid:
                results.append({"row_id": row_id, "status": "REARRANGE_FIRST", "reason": "VALID_REPACKING_WITNESS", "parking_state": "ADJUSTABLE", "current_capacity": 0, "recommended_placement": {"source": "REPACKING_WITNESS", "witness_index": 0, "witness_count": len(witnesses)}, "selection_policy": "FIRST_DETERMINISTIC_REPACKING_WITNESS", "validation": True})
            else:
                results.append({"row_id": row_id, "status": "NOT_RECOMMENDED", "reason": "INVALID_REPACKING_WITNESS", "parking_state": "ADJUSTABLE", "current_capacity": row.get("capacity", 0), "recommended_placement": None, "validation": True})
            continue
        if not eligible:
            results.append({"row_id": row_id, "status": "NOT_RECOMMENDED", "reason": "PARKING_STATE_NOT_AVAILABLE", "parking_state": state.get("state"), "current_capacity": row.get("capacity", 0), "recommended_placement": None, "validation": True})
            continue
        witness = row["placements"][0]
        results.append({"row_id": row_id, "status": "PARK_HERE", "reason": "VALID_CURRENT_CAPACITY_WITNESS", "parking_state": state.get("state"), "current_capacity": row["capacity"], "recommended_placement": {"source": "CURRENT_CAPACITY_WITNESS", "witness_index": 0, "geometry": witness["footprint_metric"], "anchor_metric": witness.get("anchor_metric"), "width_m": WIDTH_M, "length_m": LENGTH_M}, "selection_policy": "FIRST_DETERMINISTIC_CAPACITY_WITNESS", "validation": True})
    return {"rows": results, "validation": all(item["validation"] for item in results)}

