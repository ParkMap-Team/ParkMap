from __future__ import annotations

import math
from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.services.capacity_service import _parts
from app.services.virtual_fitting_service import FITTING_TOLERANCE_M, _row_angle

PARKING_PITCH_WIDTH_M = 0.66
MOTORCYCLE_LENGTH_M = 2.0
FIELD_PARKING_PITCH_WIDTH_M = PARKING_PITCH_WIDTH_M
FIELD_MOTORCYCLE_LENGTH_M = MOTORCYCLE_LENGTH_M
PROVENANCE = "FIELD_OBSERVATION_EXPERIMENTAL"


def _rect(anchor: Point) -> Polygon:
    return Polygon([(anchor.x, anchor.y), (anchor.x + FIELD_PARKING_PITCH_WIDTH_M, anchor.y), (anchor.x + FIELD_PARKING_PITCH_WIDTH_M, anchor.y + FIELD_MOTORCYCLE_LENGTH_M), (anchor.x, anchor.y + FIELD_MOTORCYCLE_LENGTH_M)])


def _geometry(geometry: Any) -> dict[str, Any]:
    if geometry.is_empty:
        return {"polygons": []}
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    return {"polygons": [[[{"x_m": float(x), "y_m": float(y)} for x, y in list(p.exterior.coords)[:-1]]] for p in polygons]}


def _deserialize(geometry: dict[str, Any]) -> Polygon:
    polygons = []
    for rings in geometry.get("polygons", []):
        if rings:
            polygons.append(Polygon([(p["x_m"], p["y_m"]) for p in rings[0]]))
    return unary_union(polygons) if polygons else Polygon()


def _placements(row: Polygon, free: Any) -> list[dict[str, Any]]:
    angle = _row_angle(row); origin = row.centroid
    local = rotate(translate(free, -origin.x, -origin.y), -angle, origin=(0, 0))
    candidates = []
    for component in _parts(local):
        if component.geom_type != "Polygon": continue
        y = component.bounds[1]; start = component.bounds[0]; end = component.bounds[2] - FIELD_PARKING_PITCH_WIDTH_M
        count = max(0, math.floor((end - start + FITTING_TOLERANCE_M) / FIELD_PARKING_PITCH_WIDTH_M) + 1)
        for i in range(count):
            anchor = Point(start + i * FIELD_PARKING_PITCH_WIDTH_M, y); footprint = _rect(anchor)
            if local.buffer(FITTING_TOLERANCE_M).covers(footprint): candidates.append(footprint)
    selected = []
    for footprint in candidates:
        if all(footprint.intersection(other).area <= FITTING_TOLERANCE_M for other in selected): selected.append(footprint)
    return [{"footprint_metric": _geometry(rotate(translate(item, origin.x, origin.y), angle, origin=(origin.x, origin.y)))} for item in selected]


def calculate_field_pitch_experiment(rows, included, production_free):
    results = []
    for row_id, row in rows:
        occupied_parts = []
        for _item, canonical, _assignment in included:
            min_x, min_y, _max_x, _max_y = canonical.bounds
            core = Polygon([(min_x, min_y), (min_x + FIELD_PARKING_PITCH_WIDTH_M, min_y), (min_x + FIELD_PARKING_PITCH_WIDTH_M, min_y + FIELD_MOTORCYCLE_LENGTH_M), (min_x, min_y + FIELD_MOTORCYCLE_LENGTH_M)])
            intersection = core.intersection(row)
            if intersection.area > 1e-8: occupied_parts.append(intersection)
        occupied = unary_union(occupied_parts) if occupied_parts else Polygon()
        free = row.difference(occupied)
        placements = _placements(row, free)
        geometries = [_deserialize(item["footprint_metric"]) for item in placements]
        geometry_valid = all(not item.is_empty and item.is_valid for item in geometries)
        dimensions_valid = all(abs(item.area - PARKING_PITCH_WIDTH_M * MOTORCYCLE_LENGTH_M) <= FITTING_TOLERANCE_M for item in geometries)
        containment_valid = all(row.buffer(FITTING_TOLERANCE_M).covers(item) for item in geometries)
        occupied_valid = all(item.intersection(occupied).area <= FITTING_TOLERANCE_M for item in geometries)
        overlap_valid = all(geometries[i].intersection(geometries[j]).area <= FITTING_TOLERANCE_M for i in range(len(geometries)) for j in range(i + 1, len(geometries)))
        count_valid = len(placements) == len(geometries)
        details = {"geometry_valid": geometry_valid, "dimensions_valid": dimensions_valid, "row_containment_valid": containment_valid, "occupied_collision_valid": occupied_valid, "witness_overlap_valid": overlap_valid, "witness_count_valid": count_valid}
        results.append({"row_id": row_id, "occupied_area_m2": occupied.area, "free_area_m2": free.area, "capacity": len(placements), "witness_count": len(placements), "placements": placements, "validation": all(details.values()), "validation_details": details})
    return {"status": "EXPERIMENTAL", "provenance": PROVENANCE, "calibration": {"parking_pitch_width_m": PARKING_PITCH_WIDTH_M, "motorcycle_length_m": MOTORCYCLE_LENGTH_M, "source": "configurable field-calibrated candidate"}, "width_m": PARKING_PITCH_WIDTH_M, "length_m": MOTORCYCLE_LENGTH_M, "rows": results, "validation": all(item["validation"] for item in results)}
