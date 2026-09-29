from __future__ import annotations

from typing import Any

from shapely.geometry import Polygon

EPSILON = 1e-8


def calculate_uncertainty(rows: list[tuple[str, Polygon]], included: list[tuple[dict[str, Any], Polygon, tuple[Any, ...]]]) -> dict[str, Any]:
    by_row = {row_id: {"row_id": row_id, "status": "CLEAR", "affected_detection_ids": [], "reasons": [], "evidence": [], "validation": True} for row_id, _ in rows}
    for item, footprint, assignment in included:
        state = assignment[1]
        if state not in {"AMBIGUOUS", "UNASSIGNED"}:
            continue
        reason = "AMBIGUOUS_ROW_ASSIGNMENT" if state == "AMBIGUOUS" else "UNASSIGNED_ROW_INTERSECTION"
        if footprint.is_empty or not footprint.is_valid:
            continue
        for row_id, row in rows:
            area = footprint.intersection(row).area
            if area <= EPSILON:
                continue
            target = by_row[row_id]
            target["status"] = "UNCERTAIN"
            detection_id = item["detection_id"]
            if detection_id not in target["affected_detection_ids"]:
                target["affected_detection_ids"].append(detection_id)
            if reason not in target["reasons"]:
                target["reasons"].append(reason)
            evidence = {"detection_id": detection_id, "reason": reason, "affected_row_id": row_id, "intersection_area_m2": area}
            if not any(e["detection_id"] == detection_id and e["reason"] == reason for e in target["evidence"]):
                target["evidence"].append(evidence)
    output = list(by_row.values())
    for result in output:
        result["affected_detection_ids"].sort()
        result["reasons"].sort()
        result["evidence"].sort(key=lambda item: (item["detection_id"], item["reason"], item["affected_row_id"]))
    return {"rows": output, "validation": True}
