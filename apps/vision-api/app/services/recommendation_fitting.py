"""Shared geometric recommendation search, with all routing and clearance supplied by the caller."""

from collections.abc import Mapping

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services.motorcycle_reference_sizes import load_rules
from app.services.recommendation_models import GuardBoothFit
from app.services.region_clipping_service import polygon_shape
from app.services.width_band_fitting import (
    covers,
    fit_slots,
    is_recorded_preview,
    iter_width_bands,
    required_width_m,
)


def fit_recommendation(area: ParkingAreaLiveState, family: str, entrance: MetricGroundPoint, scale: float,
                       blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None, *,
                       aisles: Mapping[str, float | None], right_access_x: float, clearance_m: float,
                       entrance_y: float) -> GuardBoothFit:
    size = load_rules().classes[family]
    result = GuardBoothFit(family=family, width_m=size.width_m, length_m=size.length_m, observed_at=area.observed_at)
    if not is_recorded_preview(area):
        return result
    candidates = []
    previous_frame = polygon_shape(preferred) if preferred is not None else None
    width = required_width_m(family, scale, clearance_m=clearance_m)
    for region, angle, available, free in iter_width_bands(area, blocked, row_ids=aisles):
        aisle = aisles[region.row_id]
        if previous_frame is not None and covers(free, previous_frame) and previous_frame.centroid.x < right_access_x:
            candidates = [(-1, previous_frame.centroid.x, previous_frame.centroid.y, aisle, previous_frame)]
            break
        if previous_frame is not None:
            free = free.difference(previous_frame)
        for frame in fit_slots(free, available, width, angle):
            x, y = frame.centroid.coords[0]
            if x < right_access_x:
                distance = right_access_x - x
                # For a pin-only row, use its position to rank it without inventing an aisle.
                distance += abs(y - entrance_y) if aisle is None else aisle - entrance_y + abs(y - aisle)
                candidates.append((distance, x, y, aisle, frame))
    if not candidates:
        return result
    _, x, y, aisle, frame = min(candidates, key=lambda item: item[:4])
    result.polygon = [[MetricGroundPoint(x_m=px, y_m=py) for px, py in list(frame.exterior.coords)[:-1]]]
    if aisle is None:
        return result
    result.route = [entrance, *[MetricGroundPoint(x_m=px, y_m=py) for px, py in [
        (entrance.x_m, entrance_y), (right_access_x, entrance_y), (right_access_x, aisle), (x, aisle), (x, y),
    ]]]
    return result
