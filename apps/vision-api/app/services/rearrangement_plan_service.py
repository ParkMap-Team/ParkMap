from __future__ import annotations

from typing import Any


def build_rearrangement_plan(capacity: dict[str, Any], parking_state: dict[str, Any], recommendation: dict[str, Any], repacking: dict[str, Any]) -> dict[str, Any]:
    """Expose a proven target arrangement; identity/movement matching is not computed."""
    states = {item.get("row_id"): item for item in parking_state.get("rows", [])}
    recs = {item.get("row_id"): item for item in recommendation.get("rows", [])}
    caps = {item.get("row_id"): item for item in capacity.get("rows", [])}
    plans = []
    for source in repacking.get("rows", []):
        row_id = source.get("row_id")
        state = states.get(row_id, {})
        rec = recs.get(row_id, {})
        cap = caps.get(row_id, {})
        witnesses = source.get("witness_placements")
        required = state.get("state") == "ADJUSTABLE" and rec.get("status") == "REARRANGE_FIRST" and rec.get("recommended_placement", {}).get("source") == "REPACKING_WITNESS" and source.get("validation") is True and source.get("optimality") == "PROVEN" and cap.get("capacity") == 0 and isinstance(source.get("repacked_additional_capacity"), int) and source["repacked_additional_capacity"] > 0
        malformed = not isinstance(witnesses, list) or not isinstance(cap.get("capacity"), int) or not isinstance(source.get("validation"), bool)
        if required and witnesses:
            plans.append({"version": "V1", "status": "READY", "validation": True, "row_id": row_id, "source": "REPACKING_WITNESS", "current_load": source.get("current_load", 0), "current_additional_capacity": source.get("current_additional_capacity", 0), "repacked_total_capacity": source.get("repacked_total_capacity", 0), "repacked_additional_capacity": source["repacked_additional_capacity"], "repacking_gain": source.get("repacking_gain", 0), "target_arrangement": {"placement_count": len(witnesses), "placements": witnesses}, "movement_assignment": {"status": "NOT_COMPUTED"}})
        else:
            plans.append({"version": "V1", "status": "INVALID" if malformed or (state.get("state") == "ADJUSTABLE" and rec.get("status") == "REARRANGE_FIRST") else "NOT_APPLICABLE", "validation": False if malformed else True, "row_id": row_id, "source": "NONE", "current_load": source.get("current_load", 0), "current_additional_capacity": source.get("current_additional_capacity", 0), "repacked_total_capacity": source.get("repacked_total_capacity", 0), "repacked_additional_capacity": source.get("repacked_additional_capacity", 0), "repacking_gain": source.get("repacking_gain", 0), "target_arrangement": {"placement_count": 0, "placements": []}, "movement_assignment": {"status": "NOT_COMPUTED"}})
    return {"version": "V1", "plans": plans, "validation": all(item["validation"] for item in plans) if plans else True}
