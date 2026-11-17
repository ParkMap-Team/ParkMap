"""Place variable-size motorcycle frames in continuous Sripatum preview bands."""

import math
from datetime import datetime, timedelta
from threading import Lock
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, UUID4
from shapely import get_parts, prepare
from shapely.affinity import rotate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services.motorcycle_reference_sizes import load_rules
from app.services.region_clipping_service import polygon_shape

PreviewFamily = Literal["grand_filano", "forza"]
AISLES = {"row_2": 10.2, "row_3": 10.2, "row_4": 3.2, "row_5": 3.2}
RIGHT_ACCESS_X = 28.9
CLEARANCE_M = 0.05
SEARCH_STEP_M = 0.10
HOLD_DURATION = timedelta(minutes=2)
RETRY_WINDOW = timedelta(minutes=5)


class GuardBoothFitRequest(BaseModel):
    family: PreviewFamily
    request_id: UUID4
    observed_at: AwareDatetime


class GuardBoothFitHold(BaseModel):
    polygon: MetricPolygon
    observed_at: datetime
    expires_at: datetime


class GuardBoothFit(BaseModel):
    family: PreviewFamily
    width_m: float
    length_m: float
    observed_at: datetime | None
    polygon: MetricPolygon | None = None
    route: list[MetricGroundPoint] = []
    expires_at: datetime | None = None
    holds: list[GuardBoothFitHold] = []


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
        if not isinstance(part, Polygon):
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
    dx, dy = max(((x2-x1, y2-y1) for (x1, y1), (x2, y2) in zip(points, points[1:])), key=lambda edge: math.hypot(*edge))
    return math.degrees(math.atan2(dy, dx)) % 180


def fit_recorded_preview(area: ParkingAreaLiveState, family: PreviewFamily, entrance: MetricGroundPoint, scale: float, blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None) -> GuardBoothFit:
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
        free = band.intersection(row).difference(occupied)
        aisle = AISLES[region.row_id]
        if previous_frame is not None and free.covers(previous_frame) and previous_frame.centroid.x < RIGHT_ACCESS_X:
            candidates = [(-1, previous_frame.centroid.x, previous_frame.centroid.y, aisle, previous_frame)]
            break
        if previous_frame is not None:
            free = free.difference(previous_frame)
        for frame in fit_frames(free, width, length, _row_direction(row)):
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


class RecordedPreviewHolds:
    """One local preview API process owns the holds for Sripatum."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._issued: dict[UUID, tuple[GuardBoothFit, GuardBoothFitHold]] = {}
        self._earlier_holds: list[GuardBoothFitHold] = []

    def reserve(self, area: ParkingAreaLiveState, request: GuardBoothFitRequest, entrance: MetricGroundPoint, scale: float, now: datetime) -> GuardBoothFit:
        with self._lock:
            self._issued = {
                key: item for key, item in self._issued.items() if now < item[1].expires_at + RETRY_WINDOW
            }
            self._earlier_holds = [hold for hold in self._earlier_holds if now < hold.expires_at]
            holds = [*self._earlier_holds, *(hold for _, hold in self._issued.values() if now < hold.expires_at)]
            if area.status != "DEMO" or area.source != "STILL_IMAGE_LOOP" or area.observed_at != request.observed_at:
                return fit_recorded_preview(area.model_copy(update={"status": "STALE", "observed_at": None}),
                                            request.family, entrance, scale).model_copy(update={"holds": holds})
            previous = self._issued.get(request.request_id)
            previous_hold = None
            if previous:
                result, previous_hold = previous
                if request.family != result.family:
                    return result.model_copy(update={"observed_at": None, "polygon": None, "route": [], "holds": holds})
                if now >= previous_hold.expires_at:
                    return result.model_copy(update={"observed_at": area.observed_at, "polygon": None, "route": [], "holds": holds})
                if area.observed_at == previous_hold.observed_at:
                    return result.model_copy(update={"holds": holds})

            result = fit_recorded_preview(
                area, request.family, entrance, scale,
                blocked=[hold.polygon for hold in holds if hold is not previous_hold],
                preferred=previous_hold.polygon if previous_hold else None,
            )
            if result.polygon is None or result.observed_at is None:
                return result.model_copy(update={"holds": holds})
            if previous_hold:
                if polygon_shape(previous_hold.polygon).equals(polygon_shape(result.polygon)):
                    holds = [hold for hold in holds if hold is not previous_hold]
                else:
                    self._earlier_holds.append(previous_hold)
            expires_at = previous_hold.expires_at if previous_hold else now + HOLD_DURATION
            hold = GuardBoothFitHold(polygon=result.polygon, observed_at=result.observed_at, expires_at=expires_at)
            result.expires_at = hold.expires_at
            self._issued[request.request_id] = (result, hold)
            return result.model_copy(update={"holds": [*holds, hold]})
