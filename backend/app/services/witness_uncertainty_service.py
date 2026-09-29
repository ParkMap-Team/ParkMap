from __future__ import annotations

from typing import Any
from shapely.geometry import Polygon

EPSILON = 1e-8


def _polygon(data: dict[str, Any]) -> Polygon:
    rings = data.get("polygons", [])
    if not rings or not rings[0]:
        return Polygon()
    return Polygon([(p["x_m"], p["y_m"]) for p in rings[0][0]], [[(p["x_m"], p["y_m"]) for p in ring] for ring in rings[0][1:]])


def classify_witness_uncertainty(capacity: dict[str, Any], uncertainty: dict[str, Any], detections: list[dict[str, Any]]) -> dict[str, Any]:
    evidence_by_row = {row["row_id"]: row.get("evidence", []) for row in uncertainty.get("rows", [])}
    footprint_by_id = {item.get("detection_id"): _polygon(item.get("canonical_footprint", {})) for item in detections}
    output = []
    for row in capacity.get("rows", []):
        row_id = row.get("row_id")
        witnesses = []
        for index, placement in enumerate(row.get("placements", [])):
            footprint = _polygon(placement.get("footprint_metric", {}))
            if footprint.is_empty or not footprint.is_valid:
                witnesses.append({"witness_index": index, "uncertainty_status": "INVALID", "uncertainty_evidence_ids": [], "overlaps": []})
                continue
            ids, overlaps = [], []
            malformed = False
            for evidence in evidence_by_row.get(row_id, []):
                evidence_id = evidence.get("detection_id")
                evidence_geometry = footprint_by_id.get(evidence_id)
                if evidence_geometry is None or evidence_geometry.is_empty or not evidence_geometry.is_valid:
                    malformed = True
                    continue
                area = footprint.intersection(evidence_geometry).area
                if area > EPSILON:
                    ids.append(evidence_id)
                    overlaps.append({"detection_id": evidence_id, "intersection_area_m2": area})
            status = "INVALID" if malformed else "BLOCKED_BY_UNCERTAINTY" if ids else "CLEAR"
            witnesses.append({"witness_index": index, "uncertainty_status": status, "uncertainty_evidence_ids": sorted(set(ids)), "overlaps": overlaps})
        counts = {status: sum(item["uncertainty_status"] == status for item in witnesses) for status in ("CLEAR", "BLOCKED_BY_UNCERTAINTY", "INVALID")}
        output.append({"row_id": row_id, "row_state": next((item.get("status") for item in uncertainty.get("rows", []) if item.get("row_id") == row_id), "CLEAR"), "capacity": row.get("capacity", 0), "clear_witness_count": counts["CLEAR"], "blocked_witness_count": counts["BLOCKED_BY_UNCERTAINTY"], "invalid_witness_count": counts["INVALID"], "witnesses": witnesses, "validation": len(witnesses) == row.get("capacity", 0) and sum(counts.values()) == row.get("capacity", 0)})
    return {"status": "EXPERIMENTAL", "provenance": "WITNESS_LEVEL_UNCERTAINTY_V1", "rows": output, "validation": all(row["validation"] for row in output)}
