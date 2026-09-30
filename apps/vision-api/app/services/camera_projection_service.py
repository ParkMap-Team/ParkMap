from __future__ import annotations

import math
from typing import Any


def project_metric_point(point: dict[str, float], inverse_matrix: list[list[float]]) -> dict[str, float] | None:
    try:
        x, y = float(point["x_m"]), float(point["y_m"])
        q = [inverse_matrix[0][0] * x + inverse_matrix[0][1] * y + inverse_matrix[0][2], inverse_matrix[1][0] * x + inverse_matrix[1][1] * y + inverse_matrix[1][2], inverse_matrix[2][0] * x + inverse_matrix[2][1] * y + inverse_matrix[2][2]]
        if not all(math.isfinite(value) for value in q) or abs(q[2]) <= 1e-12:
            return None
        nx, ny = q[0] / q[2], q[1] / q[2]
        return {"x": nx, "y": ny} if math.isfinite(nx) and math.isfinite(ny) else None
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def project_metric_geometry(geometry: dict[str, Any], inverse_matrix: list[list[float]]) -> dict[str, Any] | None:
    polygons = []
    for rings in geometry.get("polygons", []):
        projected_rings = []
        for ring in rings:
            projected = [project_metric_point(point, inverse_matrix) for point in ring]
            if any(point is None for point in projected):
                return None
            projected_rings.append(projected)
        polygons.append(projected_rings)
    return {"polygons": polygons} if polygons else None
