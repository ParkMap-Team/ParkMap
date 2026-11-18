"""Place variable-size motorcycle frames in continuous Sripatum preview bands."""

import math
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Annotated, Literal
from uuid import UUID

from pydantic import UUID4, AfterValidator, AwareDatetime, BaseModel
from shapely import get_parts, prepare
from shapely.affinity import rotate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services.motorcycle_reference_sizes import load_rules
from app.services.region_clipping_service import polygon_shape


def _configured_family(family: str) -> str:
    if family not in load_rules().classes:
        raise ValueError("Family has no configured reference size.")
    return family


PreviewFamily = Annotated[str, AfterValidator(_configured_family)]
AISLES = {"row_2": 10.2, "row_3": 10.2, "row_4": 3.2, "row_5": 3.2}
RIGHT_ACCESS_X = 28.9
CLEARANCE_M = 0.05
# Guards the band-depth cap against floating-point error in the rotated geometry (scaled units).
DEPTH_TOLERANCE = 1e-6
SEARCH_STEP_M = 0.10
HOLD_DURATION = timedelta(minutes=2)


class GuardBoothFitRequest(BaseModel):
    family: PreviewFamily
    request_id: UUID4
    observed_at: AwareDatetime
    # The Entrance clip replays one scene per photo, so its riders' holds end when the area shows another photo.
    ends_with_photo: bool = False


class GuardBoothFitHold(BaseModel):
    polygon: MetricPolygon
    observed_at: datetime
    expires_at: datetime
    request_id: UUID | None = None
    channel: Literal["GUARD_BOOTH", "LINE"] | None = None
    stage: Literal["HELD", "AWAITING_CONFIRMATION", "OCCUPIED_CONFIRMED", "RELEASED"] = "HELD"


class GuardBoothFit(BaseModel):
    family: str
    width_m: float
    length_m: float
    observed_at: datetime | None
    polygon: MetricPolygon | None = None
    route: list[MetricGroundPoint] = []
    expires_at: datetime | None = None
    holds: list[GuardBoothFitHold] = []
    stage: Literal["HELD", "AWAITING_CONFIRMATION", "OCCUPIED_CONFIRMED", "RELEASED"] | None = None
    request_id: UUID | None = None
    server_time: datetime | None = None
    reason: Literal["HELD", "NO_FIT", "STATE_UNAVAILABLE", "FRAME_CHANGED", "PLACEMENT_UNAVAILABLE", "GEOMETRY_CHANGED", "RELEASED", "OCCUPIED_CONFIRMED", "AWAITING_CONFIRMATION"] | None = None


def _samples(low: float, high: float) -> list[float]:
    if high < low:
        return []
    steps = max(1, math.ceil((high - low) / SEARCH_STEP_M))
    step = (high - low) / steps
    return sorted({low, high, *(low + (index + 0.5) * step for index in range(steps))})


def fit_frames(free, width: float, length: float, angle: float) -> list[Polygon]:
    """Sample frames across the row, then require containment of every frame."""
    local = rotate(free, -angle, origin=(0, 0))
    prepare(local)
    frames = []
    for part in get_parts(local):
        if not isinstance(part, Polygon) or part.is_empty:
            continue
        left, bottom, right, top = part.bounds
        for x in _samples(left, right - width):
            for y in _samples(bottom, top - length):
                frame = box(x, y, x + width, y + length)
                if local.covers(frame):
                    frames.append(rotate(frame, angle, origin=(0, 0)))
    return frames


def _row_direction(row: Polygon) -> float:
    points = list(row.minimum_rotated_rectangle.exterior.coords)
    dx, dy = max(((x2-x1, y2-y1) for (x1, y1), (x2, y2) in pairwise(points)), key=lambda edge: math.hypot(*edge))
    return math.degrees(math.atan2(dy, dx)) % 180


def _band_depth(band, angle: float) -> float:
    """The band's mean depth across its row, so a narrower end never shrinks the frame to a sliver."""
    left, _, right, _ = rotate(band, -angle, origin=(0, 0)).bounds
    return band.area / (right - left) - DEPTH_TOLERANCE


def fit_recorded_preview(area: ParkingAreaLiveState, family: str, entrance: MetricGroundPoint, scale: float, blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None) -> GuardBoothFit:
    size = load_rules().classes[family]
    result = GuardBoothFit(family=family, width_m=size.width_m, length_m=size.length_m, observed_at=area.observed_at)
    if area.status != "DEMO" or area.source != "STILL_IMAGE_LOOP":
        return result
    rows = {r.row_id: polygon_shape(r.polygon) for r in area.regions if r.kind == "UNKNOWN" and r.row_id in AISLES}
    occupied = unary_union([
        *[polygon_shape(r.display_polygon or r.polygon) for r in area.regions if r.kind == "OCCUPIED"],
        *[polygon_shape(polygon) for polygon in blocked or []],
    ])
    candidates = []
    previous_frame = polygon_shape(preferred) if preferred is not None else None
    width = (size.width_m + CLEARANCE_M) * scale
    length = (size.length_m + CLEARANCE_M) * scale
    for region in area.regions:
        if region.kind != "WIDTH_SUFFICIENT" or region.row_id not in rows:
            continue
        # These bands illustrate dimension fitting in recorded preview only.
        # A region flagged as potentially occluded stays out even in preview.
        if set(region.reasons) - {"FOOTPRINT_NOT_PROVEN", "LOCAL_ROW_UNCERTAINTY"}:
            continue
        row = rows[region.row_id]
        if not row.is_valid or row.area == 0:
            continue
        band = polygon_shape(region.display_polygon or region.polygon)
        if not band.is_valid:
            continue
        available = band.intersection(row)
        if available.is_empty:
            continue
        free = available.difference(occupied)
        aisle = AISLES[region.row_id]
        if previous_frame is not None and free.covers(previous_frame) and previous_frame.centroid.x < RIGHT_ACCESS_X:
            candidates = [(-1, previous_frame.centroid.x, previous_frame.centroid.y, aisle, previous_frame)]
            break
        if previous_frame is not None:
            free = free.difference(previous_frame)
        # Only width decides a fit: a longer motorcycle may run past the row, so its frame is drawn at the band depth.
        angle = _row_direction(row)
        for frame in fit_frames(free, width, min(length, _band_depth(available, angle)), angle):
            x, y = frame.centroid.coords[0]
            if x < RIGHT_ACCESS_X:
                distance = aisle + 8 + RIGHT_ACCESS_X - x + abs(y - aisle)
                candidates.append((distance, x, y, aisle, frame))
    if not candidates:
        return result
    _, x, y, aisle, frame = min(candidates, key=lambda item: item[:4])
    result.polygon = [[MetricGroundPoint(x_m=px, y_m=py) for px, py in list(frame.exterior.coords)[:-1]]]
    result.route = [entrance, *[MetricGroundPoint(x_m=px, y_m=py) for px, py in [
        (entrance.x_m, -8), (RIGHT_ACCESS_X, -8), (RIGHT_ACCESS_X, aisle), (x, aisle), (x, y),
    ]]]
    return result
