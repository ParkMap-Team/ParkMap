"""Shared width-band geometry, with no rider, route or Guard Booth policy."""

import math
from collections.abc import Container
from itertools import pairwise

from shapely import get_parts
from shapely.affinity import rotate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from app.models import MetricPolygon, ParkingAreaLiveState
from app.services.motorcycle_reference_sizes import load_rules
from app.services.region_clipping_service import polygon_shape

# Containment permits only numerical residue from cutting/rebuilding the same band.
COVER_TOLERANCE_M2 = 1e-8
# Width tolerance is floating-point residue, not additional parking clearance.
WIDTH_TOLERANCE_M = 1e-9
SEARCH_STEP_M = .10


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


def is_recorded_preview(area: ParkingAreaLiveState) -> bool:
    return area.status == "DEMO" and area.source == "STILL_IMAGE_LOOP"


def iter_width_bands(area: ParkingAreaLiveState, blocked: list[MetricPolygon] | None = None, *, row_ids: Container[str] | None = None):
    """Yield (region, row direction, band in its row, free part), within caller-selected rows.

    Ground a neighbouring row's outline also covers is cut from the band: it is not this row's to offer,
    and a neighbour's motorcycle reaching into it must not block a slot across this row."""
    outlines = {r.row_id: polygon_shape(r.polygon) for r in area.regions if r.kind == "UNKNOWN" and r.row_id}
    rows = {row_id: row for row_id, row in outlines.items() if row_ids is None or row_id in row_ids}
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
        yield region, _row_direction(row), available, available.difference(occupied)


def required_width_m(family: str, scale: float, *, clearance_m: float) -> float:
    """Physical reference width plus the caller's clearance, in display coordinates."""
    return (load_rules().classes[family].width_m + clearance_m) * scale
