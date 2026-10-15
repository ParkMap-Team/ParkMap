from __future__ import annotations

from typing import Any

from shapely.geometry import Polygon

from app.services.capacity_service import calculate_row_capacity
from app.services.virtual_fitting_service import WIDTH_M


def calculate_repacking(rows: list[tuple[str, Polygon]], occupied_rows: list[dict[str, Any]], capacity: dict[str, Any], uncertainty: dict[str, Any]) -> dict[str, Any]:
    occupied = {item["row_id"]: item for item in occupied_rows}
    current_capacity = {item["row_id"]: item for item in capacity.get("rows", [])}
    uncertain = {item["row_id"]: item for item in uncertainty.get("rows", [])}
    results = []
    for row_id, row in rows:
        contributions = occupied.get(row_id, {}).get("contributions", [])
        ids = sorted({item["detection_id"] for item in contributions})
        load = len(ids)
        current_additional = int(current_capacity.get(row_id, {}).get("capacity", 0))
        total = calculate_row_capacity(row_id, row, row)
        repacked_total = int(total["capacity"])
        proof_eligible = _rectangular_fixed_orientation(row)
        repacked_additional = max(repacked_total - load, 0)
        gain = repacked_additional - current_additional
        validation = repacked_total == len(total["placements"]) and gain == repacked_additional - current_additional
        results.append({"row_id": row_id, "current_load": load, "current_additional_capacity": current_additional, "repacked_total_capacity": repacked_total, "repacked_additional_capacity": repacked_additional, "repacking_gain": gain, "status": "REPACKING_POSSIBLE" if gain > 0 else "NO_REPACKING_GAIN", "uncertainty": uncertain.get(row_id, {}).get("status"), "contributing_detection_ids": ids, "witness_placements": total["placements"], "optimality": "PROVEN" if proof_eligible and repacked_total == _rectangular_upper_bound(row) else "NOT_PROVEN", "validation": validation})
    return {"rows": results, "validation": all(item["validation"] for item in results)}


def _rectangular_upper_bound(row: Polygon) -> int:
    points = list(row.exterior.coords)[:-1]
    lengths = [((points[(i + 1) % len(points)][0] - points[i][0]) ** 2 + (points[(i + 1) % len(points)][1] - points[i][1]) ** 2) ** 0.5 for i in range(len(points))]
    return int((lengths[0] + 1e-7) // WIDTH_M)


def _rectangular_fixed_orientation(row: Polygon) -> bool:
    if not row.is_valid or row.geom_type != "Polygon" or len(row.interiors) != 0:
        return False
    points = list(row.exterior.coords)[:-1]
    if len(points) != 4:
        return False
    vectors = [(points[(i + 1) % 4][0] - points[i][0], points[(i + 1) % 4][1] - points[i][1]) for i in range(4)]
    return all(abs(vectors[i][0] * vectors[(i + 1) % 4][0] + vectors[i][1] * vectors[(i + 1) % 4][1]) <= 1e-7 for i in range(4))
