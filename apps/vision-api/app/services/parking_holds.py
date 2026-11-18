"""Transactional recommendation ledger; entrance and parking cameras need no shared identity."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from fastapi import HTTPException
from shapely import get_parts
from shapely.geometry import Polygon
from shapely.ops import unary_union
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import repository
from app.db.tables import ParkingHold
from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.guard_booth_fitting import (
    AISLES,
    HOLD_DURATION,
    GuardBoothFit,
    GuardBoothFitHold,
    GuardBoothFitRequest,
    fit_recorded_preview,
)
from app.services.region_clipping_service import polygon_shape

Channel = Literal["GUARD_BOOTH", "LINE"]
BLOCKING = ("HELD", "AWAITING_CONFIRMATION", "OCCUPIED_CONFIRMED")


@dataclass
class HoldContext:
    area: ParkingAreaLiveState
    entrance: MetricGroundPoint
    scale: float
    geometry_version: str


def _unsafe_polygons(area: ParkingAreaLiveState):
    demo = area.status == "DEMO" and area.source == "STILL_IMAGE_LOOP"
    allowed = {"FOOTPRINT_NOT_PROVEN", "LOCAL_ROW_UNCERTAINTY"} if demo else set()
    return [r.display_polygon or r.polygon for r in area.regions
            if r.kind in ("UNKNOWN", "ALMOST_AVAILABLE") and
            (not demo or r.kind != "UNKNOWN" or r.row_id not in AISLES or bool(set(r.reasons) - allowed))]


def _transition(hold: ParkingHold, stage: str, now: datetime, area: ParkingAreaLiveState, reason: str) -> None:
    if hold.stage == stage:
        return
    hold.stage = stage
    hold.history = [*hold.history, {
        "stage": stage, "at": now.isoformat(), "reason": reason,
        "observed_at": area.observed_at.isoformat() if area.observed_at else None,
        "processed_at": area.processed_at.isoformat() if area.processed_at else None,
    }]


def _reconcile(holds: list[ParkingHold], context: HoldContext, now: datetime) -> None:
    area = context.area
    current = area.status in ("LIVE", "DEMO") and area.observed_at is not None and area.processed_at is not None
    demo = area.status == "DEMO" and area.source == "STILL_IMAGE_LOOP"
    for hold in holds:
        if hold.stage == "RELEASED":
            continue
        if current and demo and hold.ends_with_photo and area.observed_at != hold.observed_at:
            _transition(hold, "RELEASED", now, area, "PREVIEW_SCENE_ENDED")
            continue
        compatible = current and hold.area_id == area.parking_area_id and hold.geometry_version == context.geometry_version
        newer = compatible and area.processed_at > hold.processed_at
        frame = polygon_shape(GuardBoothFit.model_validate(hold.result).polygon)
        if newer:
            occupied = unary_union([polygon_shape(r.display_polygon or r.polygon) for r in area.regions if r.kind == "OCCUPIED"])
            if frame.intersection(occupied).area > 1e-8:
                _transition(hold, "OCCUPIED_CONFIRMED", now, area, "SEGMENT_OCCUPIED")
                continue
        if now < hold.expires_at:
            continue
        # Live capture must be after the deadline. Demo photos use processing time
        # and never establish live-camera evidence.
        evidence_at = area.processed_at if demo else area.observed_at
        after_deadline = newer and evidence_at >= hold.expires_at
        if after_deadline:
            allowed = {"FOOTPRINT_NOT_PROVEN", "LOCAL_ROW_UNCERTAINTY"} if demo else set()
            empty = unary_union([
                polygon_shape(r.display_polygon or r.polygon) for r in area.regions
                if r.kind == ("WIDTH_SUFFICIENT" if demo else "AVAILABLE") and not (set(r.reasons) - allowed)
            ])
            # Demo UNKNOWN row envelopes coexist with width bands. Actual
            # occlusion or other uncertainty still vetoes release.
            unsafe = unary_union([polygon_shape(p) for p in _unsafe_polygons(area)])
            if empty.covers(frame) and frame.intersection(unsafe).area <= 1e-8:
                _transition(hold, "RELEASED", now, area, "FRESH_EMPTY_AFTER_DEADLINE")
                continue
        if hold.stage != "OCCUPIED_CONFIRMED":
            _transition(hold, "AWAITING_CONFIRMATION", now, area, "EMPTY_NOT_CONFIRMED")


def _locked(session: Session, site_id: str, load: Callable[[], HoldContext], now: datetime):
    # Load evidence after the site lock. All API instances share this lock.
    if repository.lock_site(session, site_id) is None:
        raise HTTPException(404, "Site not found.")
    context = load()
    holds = list(session.scalars(select(ParkingHold).where(ParkingHold.site_id == site_id, ParkingHold.stage.in_(BLOCKING))))
    _reconcile(holds, context, now)
    return context, holds


def _shown(holds: list[ParkingHold]) -> list[GuardBoothFitHold]:
    return [GuardBoothFitHold(
        polygon=h.result["polygon"], observed_at=h.observed_at, expires_at=h.expires_at,
        request_id=h.request_id, channel=h.channel, stage=h.stage,
    ) for h in holds if h.stage in BLOCKING]


def snapshot(session: Session, site_id: str, load: Callable[[], HoldContext], now: datetime) -> list[GuardBoothFitHold]:
    _, holds = _locked(session, site_id, load, now)
    return _shown(holds)


def mask_held_space(session: Session, site_id: str, area: ParkingAreaLiveState) -> ParkingAreaLiveState:
    """Subtract held frames in Python so LINE's green regions exclude them too."""
    holds = list(session.scalars(select(ParkingHold).where(
        ParkingHold.site_id == site_id, ParkingHold.area_id == area.parking_area_id, ParkingHold.stage.in_(BLOCKING),
    )))
    if not holds or area.status not in ("LIVE", "DEMO"):
        return area
    polygons = [GuardBoothFit.model_validate(h.result).polygon for h in holds]
    blocked = unary_union([polygon_shape(p) for p in polygons])
    regions = []
    for region in area.regions:
        if region.kind not in ("AVAILABLE", "WIDTH_SUFFICIENT", "ALMOST_AVAILABLE"):
            regions.append(region)
            continue
        for part in get_parts(polygon_shape(region.display_polygon or region.polygon).difference(blocked)):
            if not isinstance(part, Polygon) or part.area <= 1e-8:
                continue
            rings = [part.exterior, *part.interiors]
            polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in list(r.coords)[:-1]] for r in rings]
            regions.append(region.model_copy(update={"polygon": polygon, "display_polygon": None}))
    regions.extend(LiveRegion(kind="UNKNOWN", polygon=p, reasons=["RECOMMENDATION_HELD"]) for p in polygons)
    return area.model_copy(update={"regions": regions})


def reserve(session: Session, site_id: str, request: GuardBoothFitRequest, channel: Channel,
            load: Callable[[], HoldContext], now: datetime) -> GuardBoothFit:
    if channel == "LINE" and request.ends_with_photo:
        raise HTTPException(422, "LINE holds do not end with a preview photo.")
    context, holds = _locked(session, site_id, load, now)
    area = context.area
    previous = session.get(ParkingHold, (site_id, request.request_id))
    if previous and (previous.family != request.family or previous.channel != channel or previous.ends_with_photo != request.ends_with_photo):
        raise HTTPException(409, "Request ID already belongs to a different recommendation.")
    if previous:
        result = GuardBoothFit.model_validate(previous.result)
        result.stage = previous.stage
        result.holds = _shown(holds)
        # Keep issued geometry immutable; do not move a rider's instruction on a retry.
        valid = fit_recorded_preview(area, request.family, context.entrance, context.scale,
                                     preferred=result.polygon, blocked=[*_unsafe_polygons(area), *[h.polygon for h in result.holds if h.request_id != request.request_id]])
        if (previous.stage != "HELD" or previous.geometry_version != context.geometry_version
                or now >= previous.expires_at or request.observed_at != area.observed_at
                or valid.polygon is None or not polygon_shape(valid.polygon).equals(polygon_shape(result.polygon))):
            result.polygon, result.route = None, []
        result.observed_at = area.observed_at
        return result
    result = fit_recorded_preview(area, request.family, context.entrance, context.scale, blocked=[*_unsafe_polygons(area), *[h.polygon for h in _shown(holds)]])
    result.request_id = request.request_id
    if (request.observed_at != area.observed_at or area.processed_at is None
            or any(h.stage in BLOCKING and h.geometry_version != context.geometry_version for h in holds)):
        result.polygon, result.route, result.observed_at = None, [], None
    if result.polygon is not None:
        result.expires_at = now + HOLD_DURATION
        result.stage = "HELD"
        hold = ParkingHold(
            site_id=site_id, request_id=request.request_id, channel=channel, family=request.family,
            area_id=area.parking_area_id, geometry_version=context.geometry_version, ends_with_photo=request.ends_with_photo,
            stage="HELD", issued_at=now, expires_at=result.expires_at, observed_at=area.observed_at,
            processed_at=area.processed_at, result=result.model_dump(mode="json"),
            history=[{"stage": "HELD", "at": now.isoformat(), "reason": "RECOMMENDATION_ISSUED"}],
        )
        session.add(hold)
        session.flush()
        holds.append(hold)
    result.holds = _shown(holds)
    return result
