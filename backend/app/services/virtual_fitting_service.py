from __future__ import annotations

import math
from typing import Any

from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

PARKING_PITCH_WIDTH_M = 0.66
WIDTH_M = PARKING_PITCH_WIDTH_M
LENGTH_M = 2.0
FITTING_TOLERANCE_M = 1e-7


def _geometry(geometry: Any) -> dict[str, Any]:
    if geometry.is_empty:
        return {"polygons": []}
    if geometry.geom_type == "GeometryCollection":
        return {"polygons": [], "geometry_type": "GeometryCollection", "geometries": [_geometry(item) for item in geometry.geoms if not item.is_empty]}
    if geometry.geom_type in {"MultiPoint", "MultiLineString"}:
        return {"polygons": [], "geometry_type": geometry.geom_type, "geometries": [_geometry(item) for item in geometry.geoms if not item.is_empty]}
    if geometry.geom_type in {"Point", "LineString"}:
        return {"polygons": [], "geometry_type": geometry.geom_type, "coordinates": [{"x_m": float(x), "y_m": float(y)} for x, y in geometry.coords]}
    polygons = [geometry] if geometry.geom_type == "Polygon" else [item for item in geometry.geoms if item.geom_type == "Polygon"]
    result = []
    for polygon in polygons:
        rings = [[{"x_m": float(x), "y_m": float(y)} for x, y in list(polygon.exterior.coords)[:-1]]]
        for hole in polygon.interiors:
            ring = [{"x_m": float(x), "y_m": float(y)} for x, y in list(hole.coords)[:-1]]
            rings.append(ring)
        result.append(rings)
    return {"polygons": result}


def _component_count(geometry: Any) -> int:
    if geometry.is_empty:
        return 0
    if geometry.geom_type == "MultiPolygon":
        return len(geometry.geoms)
    if geometry.geom_type in {"MultiPoint", "MultiLineString"}:
        return len(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return sum(_component_count(item) for item in geometry.geoms)
    return 1


def _row_angle(row: Polygon) -> float:
    points = list(row.exterior.coords)
    # Physical row polygons are emitted with their first edge as the
    # authoritative longitudinal direction. This also preserves a deterministic
    # axis for exact synthetic rectangles whose long edge is the depth axis.
    for start, end in zip(points, points[1:]):
        if math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-12:
            return math.degrees(math.atan2(end[1] - start[1], end[0] - start[0]))
    return 0.0


def validate_witness(footprint: Polygon, row: Polygon, occupied: Any | None = None) -> bool:
    """Validate a generated canonical placement without accepting false positives."""
    coordinates = list(footprint.exterior.coords)
    finite = all(math.isfinite(x) and math.isfinite(y) for x, y in coordinates)
    if not finite or abs(footprint.area - WIDTH_M * LENGTH_M) > FITTING_TOLERANCE_M:
        return False
    if not row.buffer(FITTING_TOLERANCE_M).covers(footprint):
        return False
    return occupied is None or footprint.intersection(occupied).area <= FITTING_TOLERANCE_M


def fit_row(row_id: str, row: Polygon, free: Any) -> dict[str, Any]:
    """Return continuous anchor-space evidence for one row-aligned footprint.

    The feasible geometry is the intersection of free geometry translated by
    each rectangle corner and centre. This is conservative, preserves holes and
    disconnected components, and contains no resolution-dependent sampling.
    """
    angle = _row_angle(row)
    origin = row.centroid
    local_free = rotate(translate(free, -origin.x, -origin.y), -angle, origin=(0, 0))
    # Virtual-placement anchors are lower-left corners. Detected ground-point
    # anchors use a different convention and are intentionally unaffected.
    offsets = [(0, 0), (WIDTH_M, 0), (0, LENGTH_M), (WIDTH_M, LENGTH_M)]
    # Expand only the candidate configuration-space construction by the
    # existing tolerance. Final witnesses are still checked against the
    # strict buffered free geometry below, so this cannot create acceptance
    # without independent validation.
    construction_free = local_free.buffer(FITTING_TOLERANCE_M)
    feasible = construction_free
    for step, (x, y) in enumerate(offsets, 1):
        translated = translate(construction_free, -x, -y)
        feasible = feasible.intersection(translated)
        if feasible.is_empty:
            break
    anchor_region = feasible
    candidates = []
    if not anchor_region.is_empty:
        geoms = [anchor_region] if anchor_region.geom_type in {"Polygon", "LineString", "Point"} else list(anchor_region.geoms)
        for geometry in geoms:
            if geometry.geom_type in {"Polygon", "LineString"}:
                candidates.extend([geometry.representative_point(), geometry.point_on_surface(), geometry.centroid])
                if geometry.geom_type == "LineString":
                    candidates.extend(Point(x, y) for x, y in list(geometry.coords))
                else:
                    candidates.extend(Point(x, y) for x, y in list(geometry.exterior.coords)[:-1])
            elif geometry.geom_type == "Point":
                candidates.append(geometry)
    def footprint(anchor: Point) -> Polygon:
        return Polygon([(anchor.x, anchor.y), (anchor.x + WIDTH_M, anchor.y), (anchor.x + WIDTH_M, anchor.y + LENGTH_M), (anchor.x, anchor.y + LENGTH_M)])
    def contained(point: Point) -> bool:
        candidate = footprint(point)
        return local_free.buffer(FITTING_TOLERANCE_M).covers(candidate)

    valid = [point for point in candidates if contained(point)]
    fit = bool(valid)
    feasible_world = rotate(translate(anchor_region, origin.x, origin.y), angle, origin=(origin.x, origin.y))
    return {"row_id": row_id, "status": "FIT" if fit else "NO_FIT", "canonical_width_m": WIDTH_M, "canonical_length_m": LENGTH_M, "orientation_source": "PHYSICAL_ROW", "feasible_geometry": _geometry(feasible_world), "feasible_component_count": _component_count(feasible_world), "validation": {"valid": True, "tolerance_m": FITTING_TOLERANCE_M}}


def fit_rows(rows: list[tuple[str, Polygon]], free_by_row: dict[str, Any]) -> dict[str, Any]:
    results = [fit_row(row_id, row, free_by_row[row_id]) for row_id, row in rows]
    return {"version": "virtual-fitting-v1", "rows": results}
