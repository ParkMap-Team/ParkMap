"""Place variable-size motorcycle frames in continuous Sripatum preview bands."""

import math
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Annotated, Literal
from uuid import UUID

from pydantic import UUID4, AfterValidator, AwareDatetime, BaseModel
from shapely import get_parts
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
# A frame cut from a band is re-tested against geometry rebuilt from the same band; exact `covers`
# can fail on floating-point residue of about 1e-16 m^2, so containment allows this much.
COVER_TOLERANCE_M2 = 1e-8
# A slot cut at a band's end is narrower than asked; this much shortfall is floating-point residue.
WIDTH_TOLERANCE_M = 1e-9
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


def fit_slots(free, band, width: float, angle: float) -> list[Polygon]:
    """Slots `width` wide across the whole depth of `band` that lie in `free`, its unblocked part.

    Only width decides a fit, so a slot is the band's own cross-section whatever the motorcycle's length:
    a longer one may run past the row, and a mean-depth box would miss a band that narrows slightly."""
    local_free = rotate(free, -angle, origin=(0, 0))
    local_band = rotate(band, -angle, origin=(0, 0))
    _, bottom, _, top = local_band.bounds
    slots = []
    for part in get_parts(local_free):
        if not isinstance(part, Polygon) or part.is_empty:
            continue
        left, _, right, _ = part.bounds
        for x in _samples(left, right - width):
            slot = local_band.intersection(box(x, bottom, x + width, top))
            if isinstance(slot, Polygon) and not slot.is_empty and covers(local_free, slot):
                slot_left, _, slot_right, _ = slot.bounds
                if slot_right - slot_left >= width - WIDTH_TOLERANCE_M:
                    slots.append(rotate(slot, angle, origin=(0, 0)))
    return slots


def _row_direction(row: Polygon) -> float:
    points = list(row.minimum_rotated_rectangle.exterior.coords)
    dx, dy = max(((x2-x1, y2-y1) for (x1, y1), (x2, y2) in pairwise(points)), key=lambda edge: math.hypot(*edge))
    return math.degrees(math.atan2(dy, dx)) % 180


def covers(region: Polygon, frame: Polygon) -> bool:
    """`region` contains `frame` up to floating-point residue."""
    return frame.difference(region).area <= COVER_TOLERANCE_M2


def _recorded_preview(area: ParkingAreaLiveState) -> bool:
    return area.status == "DEMO" and area.source == "STILL_IMAGE_LOOP"


def _preview_bands(area: ParkingAreaLiveState, blocked: list[MetricPolygon] | None, *, routed_only: bool = True):
    """Each width band the guide may use, as (region, aisle, row direction, band in its row, free part).

    Ground a neighbouring row's outline also covers is cut from the band: it is not this row's to offer,
    and a neighbour's motorcycle reaching into it must not block a slot across this row."""
    outlines = {r.row_id: polygon_shape(r.polygon) for r in area.regions if r.kind == "UNKNOWN" and r.row_id}
    rows = {row_id: row for row_id, row in outlines.items() if not routed_only or row_id in AISLES}
    occupied = unary_union([
        *[polygon_shape(r.display_polygon or r.polygon) for r in area.regions if r.kind == "OCCUPIED"],
        *[polygon_shape(polygon) for polygon in blocked or []],
    ])
    for region in area.regions:
        if region.kind != "WIDTH_SUFFICIENT" or region.row_id not in rows:
            continue
        # These bands illustrate dimension fitting in recorded preview only.
        # Width-only preview ignores the occlusion advisory; keep it in the
        # returned reasons and still subtract detected occupancy and holds below.
        if set(region.reasons) - {"FOOTPRINT_NOT_PROVEN", "LOCAL_ROW_UNCERTAINTY", "GROUND_MAY_BE_OCCLUDED"}:
            continue
        row = rows[region.row_id]
        if not row.is_valid or row.area == 0:
            continue
        band = polygon_shape(region.display_polygon or region.polygon)
        if not band.is_valid:
            continue
        available = band.intersection(row).difference(unary_union(
            [outline for row_id, outline in outlines.items() if row_id != region.row_id and outline.is_valid]
        ))
        if available.is_empty:
            continue
        yield region, AISLES.get(region.row_id), _row_direction(row), available, available.difference(occupied)


def _slot_width(family: str, scale: float) -> float:
    return (load_rules().classes[family].width_m + CLEARANCE_M) * scale


def free_ground_for(area: ParkingAreaLiveState, family: str, scale: float, blocked: list[MetricPolygon] | None = None) -> ParkingAreaLiveState:
    """A rider's free ground on the recorded preview: only the free parts of width bands where `family`
    fits by width, independently of the guide's supported rows and access (ADR 0024).
    Any other state keeps its reported free ground."""
    if not _recorded_preview(area):
        return area
    width = _slot_width(family, scale)
    regions = [r for r in area.regions if r.kind not in ("AVAILABLE", "WIDTH_SUFFICIENT")]
    for region, _, angle, available, free in _preview_bands(area, blocked, routed_only=False):
        for part in get_parts(free):
            if isinstance(part, Polygon) and fit_slots(part, available, width, angle):
                rings = [part.exterior, *part.interiors]
                polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in list(ring.coords)[:-1]] for ring in rings]
                regions.append(region.model_copy(update={"polygon": polygon, "display_polygon": None}))
    return area.model_copy(update={"regions": regions})


def fit_recorded_preview(area: ParkingAreaLiveState, family: str, entrance: MetricGroundPoint, scale: float, blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None) -> GuardBoothFit:
    size = load_rules().classes[family]
    result = GuardBoothFit(family=family, width_m=size.width_m, length_m=size.length_m, observed_at=area.observed_at)
    if not _recorded_preview(area):
        return result
    candidates = []
    previous_frame = polygon_shape(preferred) if preferred is not None else None
    width = _slot_width(family, scale)
    for _, aisle, angle, available, free in _preview_bands(area, blocked):
        if previous_frame is not None and covers(free, previous_frame) and previous_frame.centroid.x < RIGHT_ACCESS_X:
            candidates = [(-1, previous_frame.centroid.x, previous_frame.centroid.y, aisle, previous_frame)]
            break
        if previous_frame is not None:
            free = free.difference(previous_frame)
        for frame in fit_slots(free, available, width, angle):
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
