from __future__ import annotations

import math
import os
from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon

from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, LENGTH_M, WIDTH_M, _geometry, _row_angle


def _footprint(anchor: Point) -> Polygon:
    return Polygon([(anchor.x - WIDTH_M / 2, anchor.y), (anchor.x + WIDTH_M / 2, anchor.y), (anchor.x + WIDTH_M / 2, anchor.y + LENGTH_M), (anchor.x - WIDTH_M / 2, anchor.y + LENGTH_M)])


def _parts(geometry: Any) -> list[Any]:
    if geometry.is_empty:
        return []
    if geometry.geom_type in {"Polygon", "LineString", "Point"}:
        return [geometry]
    if geometry.geom_type in {"MultiPolygon", "MultiLineString", "MultiPoint", "GeometryCollection"}:
        return [part for item in geometry.geoms for part in _parts(item)]
    return []


def _candidate_positions(component: Any, start: float, end: float) -> list[float]:
    positions = {start, end, (start + end) / 2}
    count = max(0, math.floor((end - start + FITTING_TOLERANCE_M) / WIDTH_M) + 1)
    positions.update(start + index * WIDTH_M for index in range(count))
    # Critical configuration-space boundaries arise from every polygon ring,
    # not only the outer component bounds.  Offset each longitudinal boundary
    # by half the canonical width and let final containment decide validity.
    for ring in [component.exterior, *component.interiors] if component.geom_type == "Polygon" else []:
        for x, _ in ring.coords:
            positions.add(x - WIDTH_M / 2)
            positions.add(x + WIDTH_M / 2)
    return sorted(position for position in positions if start - FITTING_TOLERANCE_M <= position <= end + FITTING_TOLERANCE_M)


def _maximum_compatible(placements: list[tuple[Point, Polygon]]) -> list[tuple[Point, Polygon]]:
    """Select a maximum cardinality compatible subset deterministically."""
    ordered = sorted(placements, key=lambda item: (item[1].bounds[2], item[1].bounds[0], item[0].x, item[0].y))
    count = len(ordered)
    best: list[list[int]] = [[] for _ in range(count)]
    for index in range(count):
        best[index] = [index]
        for previous in range(index):
            if ordered[index][1].intersection(ordered[previous][1]).area <= FITTING_TOLERANCE_M:
                candidate = best[previous] + [index]
                if len(candidate) > len(best[index]) or (len(candidate) == len(best[index]) and candidate < best[index]):
                    best[index] = candidate
    selected_indices = max(best, key=lambda value: (len(value), tuple(-item for item in value))) if best else []
    if os.getenv("PARKMAP_TRACE_CAPACITY") == "1":
        print(f"CAPACITY_SELECTION_TRACE strategy=MAXIMUM_COMPATIBLE_INTERVAL candidates={count} selected={selected_indices}")
        for index, item in enumerate(ordered):
            print(f"CAPACITY_CANDIDATE index={index} bounds={item[1].bounds} selected={index in selected_indices}")
    return [ordered[index] for index in selected_indices]


def calculate_row_capacity(row_id: str, row: Polygon, free: Any) -> dict[str, Any]:
    angle = _row_angle(row)
    origin = row.centroid
    local_free = rotate(translate(free, -origin.x, -origin.y), -angle, origin=(0, 0))
    placements: list[tuple[Point, Polygon]] = []
    for component in _parts(local_free):
        if component.is_empty:
            continue
        # The canonical anchor is the near-depth edge, so use the lowest
        # feasible local y rather than a component centroid/representative
        # point (which could be in the middle of a 2 m row).
        y = component.bounds[1]
        start, end = component.bounds[0] + WIDTH_M / 2, component.bounds[2] - WIDTH_M / 2
        for position in _candidate_positions(component, start, end):
            anchor = Point(position, y)
            candidate = _footprint(anchor)
            if local_free.buffer(FITTING_TOLERANCE_M).covers(candidate):
                placements.append((anchor, candidate))
    selected = _maximum_compatible(placements)
    selected.sort(key=lambda item: (item[0].x, item[0].y))
    witnesses = []
    for anchor, footprint in selected:
        world_anchor = rotate(translate(anchor, origin.x, origin.y), angle, origin=(origin.x, origin.y))
        world_footprint = rotate(translate(footprint, origin.x, origin.y), angle, origin=(origin.x, origin.y))
        witnesses.append({"anchor_metric": {"x_m": world_anchor.x, "y_m": world_anchor.y}, "footprint_metric": _geometry(world_footprint)})
    return {"row_id": row_id, "capacity": len(witnesses), "placements": witnesses, "validation": {"valid": all(len(item["footprint_metric"].get("polygons", [])) >= 1 for item in witnesses)}}


def calculate_capacity(rows: list[tuple[str, Polygon]], free_by_row: dict[str, Any], fitting: dict[str, Any] | None = None) -> dict[str, Any]:
    fitting_rows = {item["row_id"]: item for item in (fitting or {}).get("rows", [])}
    results = []
    for row_id, row in rows:
        authoritative = fitting_rows.get(row_id)
        if authoritative and authoritative.get("status") == "NO_FIT":
            results.append({"row_id": row_id, "capacity": 0, "placements": [], "validation": {"valid": True}})
            continue
        result = calculate_row_capacity(row_id, row, free_by_row[row_id])
        if authoritative and authoritative.get("status") == "FIT" and result["capacity"] < 1:
            result["validation"]["valid"] = False
        results.append(result)
    return {"version": "capacity-v1", "rows": results}
