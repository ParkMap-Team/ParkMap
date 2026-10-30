"""Place camera-ground evidence in the lot frame without changing physical dimensions."""

import math
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState


@dataclass(frozen=True)
class RigidPlacement:
    angle: float
    dx: float
    dy: float

    def point(self, point: MetricGroundPoint) -> MetricGroundPoint:
        c, s = math.cos(self.angle), math.sin(self.angle)
        return MetricGroundPoint(x_m=c * point.x_m - s * point.y_m + self.dx,
                                 y_m=s * point.x_m + c * point.y_m + self.dy)


def rigid_placement(source: MetricPolygon, target: MetricPolygon) -> RigidPlacement | None:
    """Ordered corresponding vertices must prove one rotation/translation, never scale or warp."""
    def vertices(ring):
        return ring[:-1] if len(ring) > 3 and ring[0] == ring[-1] else ring

    if len(source) != len(target) or any(len(vertices(a)) != len(vertices(b)) for a, b in zip(source, target, strict=True)):
        return None
    a = [p for ring in source for p in vertices(ring)]
    b = [p for ring in target for p in vertices(ring)]
    if len(a) < 3:
        return None
    ax, ay = sum(p.x_m for p in a) / len(a), sum(p.y_m for p in a) / len(a)
    bx, by = sum(p.x_m for p in b) / len(b), sum(p.y_m for p in b) / len(b)
    dot = sum((p.x_m - ax) * (q.x_m - bx) + (p.y_m - ay) * (q.y_m - by) for p, q in zip(a, b, strict=True))
    cross = sum((p.x_m - ax) * (q.y_m - by) - (p.y_m - ay) * (q.x_m - bx) for p, q in zip(a, b, strict=True))
    if math.hypot(dot, cross) < 1e-12:
        return None
    angle = math.atan2(cross, dot)
    c, s = math.cos(angle), math.sin(angle)
    placement = RigidPlacement(angle, bx - c * ax + s * ay, by - s * ax - c * ay)
    for p, q in zip(a, b, strict=True):
        moved = placement.point(p)
        if math.hypot(moved.x_m - q.x_m, moved.y_m - q.y_m) > 1e-6:
            return None
    return placement


def placement_for_calibration(payload: dict[str, Any], target: MetricPolygon | None) -> RigidPlacement | None:
    try:
        points = payload["ground_plane_homography.json"]["roi_metric"]["points"]
        source = [[MetricGroundPoint.model_validate(point) for point in points]]
        return rigid_placement(source, target) if target else None
    except (KeyError, TypeError, ValidationError):
        return None


def place_area_state(state: ParkingAreaLiveState, payload: dict[str, Any], target: MetricPolygon | None) -> ParkingAreaLiveState:
    if state.status not in ("LIVE", "DEMO"):
        return state
    # Legacy synthetic fixtures have no camera-ground frame and retain their original coordinates.
    if "ground_plane_homography.json" not in payload:
        return state
    placement = placement_for_calibration(payload, target)
    if placement is None:
        return state.model_copy(update={"status": "CALIBRATION_MISMATCH", "regions": [], "motorcycles": []})
    return state.model_copy(update={
        "regions": [region.model_copy(update={"polygon": [[placement.point(p) for p in ring] for ring in region.polygon]}) for region in state.regions],
        "motorcycles": [motorcycle.model_copy(update={
            "center": placement.point(motorcycle.center),
            "heading_rad": math.atan2(math.sin(motorcycle.heading_rad + placement.angle), math.cos(motorcycle.heading_rad + placement.angle)),
        }) for motorcycle in state.motorcycles],
    })
