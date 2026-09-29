from __future__ import annotations

from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon

from app.services.capacity_service import _candidate_positions, _footprint, _parts
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, WIDTH_M, _geometry, _row_angle


# Experimental V1 threshold; this is not a validated physical truth.
ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO = 0.10


def _metric_geometry(item: dict[str, Any]) -> Polygon | None:
    rings = item.get("polygons", []) if isinstance(item, dict) else []
    if not rings or not rings[0]:
        return None
    exterior = [(point["x_m"], point["y_m"]) for point in rings[0][0]]
    holes = [[(point["x_m"], point["y_m"]) for point in ring] for ring in rings[0][1:]]
    return Polygon(exterior, holes)


def _local_geometry(geometry: Any, origin: Point, angle: float) -> Any:
    return rotate(translate(geometry, -origin.x, -origin.y), -angle, origin=(0, 0))


def calculate_almost_available_placements(
    rows: list[tuple[str, Polygon]],
    occupied_by_row: dict[str, Any],
    free_by_row: dict[str, Any],
    capacity: dict[str, Any],
    uncertainty: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Find informational near-fit placements without changing production capacity."""
    uncertain_rows = {row["row_id"] for row in (uncertainty or {}).get("rows", []) if row.get("status") != "CLEAR"}
    results: list[dict[str, Any]] = []
    for row_id, row in rows:
        if row_id in uncertain_rows:
            continue
        occupied = occupied_by_row.get(row_id)
        if occupied is None or occupied.is_empty:
            continue
        angle = _row_angle(row)
        origin = row.centroid
        local_row = _local_geometry(row, origin, angle)
        local_occupied = _local_geometry(occupied, origin, angle)
        local_free = _local_geometry(free_by_row[row_id], origin, angle)
        green = []
        capacity_row = next((item for item in capacity.get("rows", []) if item.get("row_id") == row_id), {})
        for placement in capacity_row.get("placements", []):
            polygon = _metric_geometry(placement.get("footprint_metric", {}))
            if polygon is not None:
                green.append(_local_geometry(polygon, origin, angle))
        seen: set[tuple[float, ...]] = set()
        for component in _parts(local_row):
            start, end = component.bounds[0] + WIDTH_M / 2, component.bounds[2] - WIDTH_M / 2
            for position in _candidate_positions(component, start, end):
                candidate = _footprint(Point(position, component.bounds[1]))
                if not local_row.buffer(FITTING_TOLERANCE_M).covers(candidate):
                    continue
                if local_free.buffer(FITTING_TOLERANCE_M).covers(candidate):
                    continue
                overlap = candidate.intersection(local_occupied).area
                ratio = overlap / candidate.area if candidate.area else 0.0
                if not 0.0 < ratio <= ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO:
                    continue
                if any(candidate.intersection(item).area > FITTING_TOLERANCE_M for item in green):
                    continue
                key = tuple(round(value, 6) for value in candidate.bounds)
                if key in seen:
                    continue
                seen.add(key)
                world = rotate(translate(candidate, origin.x, origin.y), angle, origin=(origin.x, origin.y))
                results.append({"row_id": row_id, "status": "ALMOST_AVAILABLE", "footprint_metric": _geometry(world), "occupied_overlap_area_m2": overlap, "occupied_overlap_ratio": ratio, "reason": "SMALL_OCCUPIED_CONFLICT"})
    return results
