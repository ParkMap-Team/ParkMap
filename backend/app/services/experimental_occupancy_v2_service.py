"""Experimental core/soft motorcycle occupancy model.

This module is intentionally separate from production Occupied Space and Capacity.
All values are scenarios, not validated physical measurements.
"""
from __future__ import annotations

import math
from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.services.capacity_service import _parts
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, _row_angle

CANONICAL_WIDTH_M = 0.8
CANONICAL_LENGTH_M = 2.0
EXPERIMENTAL_CORE_WIDTHS_M = (0.40, 0.50, 0.60, 0.65, 0.70, 0.80)
PROVENANCE = "EXPERIMENTAL_UNVALIDATED"


def _rectangle(anchor: Point, width: float = CANONICAL_WIDTH_M, length: float = CANONICAL_LENGTH_M) -> Polygon:
    half = width / 2
    return Polygon([(anchor.x - half, anchor.y), (anchor.x + half, anchor.y), (anchor.x + half, anchor.y + length), (anchor.x - half, anchor.y + length)])


def _core(footprint: Polygon, width: float) -> Polygon:
    min_x, min_y, max_x, max_y = footprint.bounds
    center = Point((min_x + max_x) / 2, min_y)
    return _rectangle(center, width, CANONICAL_LENGTH_M)


def _serialize(geometry: Any) -> dict[str, Any]:
    if geometry.is_empty:
        return {"polygons": []}
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    result = []
    for polygon in polygons:
        rings = [[{"x_m": float(x), "y_m": float(y)} for x, y in list(polygon.exterior.coords)[:-1]]]
        for hole in polygon.interiors:
            rings.append([{"x_m": float(x), "y_m": float(y)} for x, y in list(hole.coords)[:-1]])
        result.append(rings)
    return {"polygons": result}


def _witnesses(row: Polygon, blocked_cores: list[Polygon], core_width: float) -> tuple[list[dict[str, Any]], int]:
    angle = _row_angle(row)
    origin = row.centroid
    local_row = rotate(translate(row, -origin.x, -origin.y), -angle, origin=(0, 0))
    local_blocked = [rotate(translate(core, -origin.x, -origin.y), -angle, origin=(0, 0)) for core in blocked_cores]
    candidates: list[tuple[Point, Polygon, Polygon]] = []
    candidate_count = 0
    for component in _parts(local_row):
        if component.is_empty or component.geom_type not in {"Polygon", "MultiPolygon"}:
            continue
        y = component.bounds[1]
        start, end = component.bounds[0] + CANONICAL_WIDTH_M / 2, component.bounds[2] - CANONICAL_WIDTH_M / 2
        count = max(0, math.floor((end - start + FITTING_TOLERANCE_M) / CANONICAL_WIDTH_M) + 1)
        for index in range(count):
            anchor = Point(start + index * CANONICAL_WIDTH_M, y)
            envelope = _rectangle(anchor)
            candidate_count += 1
            if not local_row.buffer(FITTING_TOLERANCE_M).covers(envelope):
                continue
            candidate_core = _core(envelope, core_width)
            if any(candidate_core.intersection(existing).area > FITTING_TOLERANCE_M for existing in local_blocked):
                continue
            candidates.append((anchor, envelope, candidate_core))
    selected: list[tuple[Point, Polygon, Polygon]] = []
    for candidate in sorted(candidates, key=lambda item: (item[0].x, item[0].y)):
        if all(candidate[2].intersection(existing[2]).area <= FITTING_TOLERANCE_M for existing in selected):
            selected.append(candidate)
    output = []
    for anchor, envelope, core in selected:
        world_anchor = rotate(translate(anchor, origin.x, origin.y), angle, origin=(origin.x, origin.y))
        world_envelope = rotate(translate(envelope, origin.x, origin.y), angle, origin=(origin.x, origin.y))
        world_core = rotate(translate(core, origin.x, origin.y), angle, origin=(origin.x, origin.y))
        output.append({"anchor_metric": {"x_m": world_anchor.x, "y_m": world_anchor.y}, "envelope": _serialize(world_envelope), "core": _serialize(world_core)})
    return output, candidate_count


def calculate_experimental_occupancy_v2(rows: list[tuple[str, Polygon]], free_by_row: dict[str, Any], included: list[tuple[dict[str, Any], Polygon, tuple[str | None, str, list[dict[str, Any]]]]]) -> dict[str, Any]:
    scenarios = []
    for core_width in EXPERIMENTAL_CORE_WIDTHS_M:
        occupied_by_row: dict[str, list[Any]] = {row_id: [] for row_id, _ in rows}
        contributing: dict[str, list[str]] = {row_id: [] for row_id, _ in rows}
        for item, canonical, _assignment in included:
            core = _core(canonical, core_width)
            for row_id, row in rows:
                intersection = core.intersection(row)
                if intersection.area > 1e-8:
                    occupied_by_row[row_id].append(intersection)
                    contributing[row_id].append(item["detection_id"])
        result_rows = []
        for row_id, row in rows:
            occupied = unary_union(occupied_by_row[row_id]) if occupied_by_row[row_id] else Polygon()
            blocked = [core for item, canonical, _assignment in included for core in [_core(canonical, core_width)] if core.intersection(row).area > 1e-8]
            witnesses, candidate_count = _witnesses(row, blocked, core_width)
            result_rows.append({"row_id": row_id, "core_width_m": core_width, "core_length_m": CANONICAL_LENGTH_M, "core_occupied_area_m2": occupied.area, "raw_core_area_sum_m2": sum(item.area for item in occupied_by_row[row_id]), "remaining_area_m2": row.area - occupied.area, "production_free_area_m2": free_by_row[row_id].area, "candidate_count_tested": candidate_count, "valid_candidate_count": len(witnesses), "contributing_detection_ids": sorted(set(contributing[row_id])), "experimental_capacity": len(witnesses), "placements": witnesses, "validation": all(len(item["envelope"].get("polygons", [])) == 1 and len(item["core"].get("polygons", [])) == 1 for item in witnesses)})
        scenarios.append({"core_width_m": core_width, "core_length_m": CANONICAL_LENGTH_M, "rows": result_rows})
    return {"status": "EXPERIMENTAL", "provenance": PROVENANCE, "canonical_envelope": {"width_m": CANONICAL_WIDTH_M, "length_m": CANONICAL_LENGTH_M}, "core_collision_policy": "POSITIVE_AREA_CORE_CORE_FORBIDDEN", "soft_overlap_policy": "SOFT_SOFT_ALLOWED_CORE_SOFT_ALLOWED", "canonical_envelope_containment": "FULLY_INSIDE_ROW", "scenarios": scenarios, "validation": True}
