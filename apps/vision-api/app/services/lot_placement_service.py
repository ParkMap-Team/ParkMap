"""Place camera-ground evidence in the lot frame without changing physical dimensions."""

import math
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.models import (
    LotModelDefinition,
    MetricGroundPoint,
    MetricPolygon,
    ParkingAreaLiveState,
)
from app.services.region_clipping_service import clip_regions, polygon_shape


@dataclass(frozen=True)
class RigidPlacement:
    angle: float
    dx: float
    dy: float

    def point(self, point: MetricGroundPoint) -> MetricGroundPoint:
        c, s = math.cos(self.angle), math.sin(self.angle)
        return MetricGroundPoint(x_m=c * point.x_m - s * point.y_m + self.dx,
                                 y_m=s * point.x_m + c * point.y_m + self.dy)


@dataclass(frozen=True)
class DisplayPlacement(RigidPlacement):
    scale: float = 1.0

    def point(self, point: MetricGroundPoint) -> MetricGroundPoint:
        return super().point(MetricGroundPoint(x_m=point.x_m*self.scale, y_m=point.y_m*self.scale))


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


def display_placement(source: MetricPolygon, target: MetricPolygon) -> DisplayPlacement | None:
    """Prove one positive uniform display scale plus rotation/translation, never warp."""
    def points(polygon):
        return [p for ring in polygon for p in (ring[:-1] if len(ring) > 3 and ring[0] == ring[-1] else ring)]

    a, b = points(source), points(target)
    if len(a) < 3 or len(a) != len(b):
        return None
    ax, ay = sum(p.x_m for p in a)/len(a), sum(p.y_m for p in a)/len(a)
    bx, by = sum(p.x_m for p in b)/len(b), sum(p.y_m for p in b)/len(b)
    source_variance = sum((p.x_m-ax)**2+(p.y_m-ay)**2 for p in a)
    target_variance = sum((p.x_m-bx)**2+(p.y_m-by)**2 for p in b)
    if source_variance <= 1e-12 or target_variance <= 1e-12:
        return None
    scale = math.sqrt(target_variance/source_variance)
    if not math.isfinite(scale) or scale <= 0:
        return None
    normalized = [[MetricGroundPoint(x_m=bx+(p.x_m-bx)/scale, y_m=by+(p.y_m-by)/scale) for p in ring] for ring in target]
    rigid = rigid_placement(source, normalized)
    if rigid is None:
        return None
    return DisplayPlacement(rigid.angle, scale*rigid.dx+(1-scale)*bx, scale*rigid.dy+(1-scale)*by, scale)


def placement_for_calibration(payload: dict[str, Any], target: MetricPolygon | None) -> DisplayPlacement | None:
    try:
        points = payload["ground_plane_homography.json"]["roi_metric"]["points"]
        source = [[MetricGroundPoint.model_validate(point) for point in points]]
        return display_placement(source, target) if target else None
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
        "regions": clip_regions([region.model_copy(update={
            "polygon": [[placement.point(p) for p in ring] for ring in region.polygon],
            "display_polygon": [[placement.point(p) for p in ring] for ring in region.display_polygon] if region.display_polygon else None,
        }) for region in state.regions], polygon_shape(target)),
        "motorcycles": [motorcycle.model_copy(update={
            "center": placement.point(motorcycle.center),
            "heading_rad": math.atan2(math.sin(motorcycle.heading_rad + placement.angle), math.cos(motorcycle.heading_rad + placement.angle)),
            "display_scale": placement.scale,
        }) for motorcycle in state.motorcycles],
    })


def replace_calibration_roi(definition: LotModelDefinition, area_id: str, points: list[MetricGroundPoint], placement: RigidPlacement) -> LotModelDefinition:
    """Preview only: retain the Setup edge direction, landmarks and metric dimensions."""
    result = definition.model_copy(deep=True)
    area = next((area for area in result.parking_areas if area.parking_area_id == area_id), None)
    if area is None:
        raise ValueError("The calibrated parking area is not in this lot model")
    follows_roi = len(result.parking_areas) == 1 and result.outline == area.polygon
    moved = [placement.point(point) for point in points]
    # Camera recalibration can change the source ROI edge direction. Preserve the
    # operator's absolute Setup direction, rather than reusing an old frame angle.
    old_a, old_b = area.polygon[0][:2]
    new_a, new_b = moved[:2]
    angle = math.atan2(old_b.y_m-old_a.y_m, old_b.x_m-old_a.x_m) - math.atan2(new_b.y_m-new_a.y_m, new_b.x_m-new_a.x_m)
    cx = (min(p.x_m for p in moved)+max(p.x_m for p in moved))/2
    cy = (min(p.y_m for p in moved)+max(p.y_m for p in moved))/2
    c, s = math.cos(angle), math.sin(angle)
    correction = RigidPlacement(angle, cx-c*cx+s*cy, cy-s*cx-c*cy)
    area.polygon = [[correction.point(point) for point in moved]]
    if follows_roi:
        result.outline = area.polygon
    return result
