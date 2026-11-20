"""Model-specific free-ground filtering for the LIFF rider map, without routing."""

from shapely import get_parts
from shapely.geometry import Polygon

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services.width_band_fitting import (
    fit_slots,
    is_recorded_preview,
    iter_width_bands,
    required_width_m,
)

# Total lateral clearance for the rider map, independent of Guard Booth policy.
RIDER_CLEARANCE_M = 0.0


def free_ground_for(area: ParkingAreaLiveState, family: str, scale: float, blocked: list[MetricPolygon] | None = None) -> ParkingAreaLiveState:
    """A rider's free ground on the recorded preview: only the free parts of width bands where `family`
    fits by width, independently of the guide's supported rows and access (ADR 0024).
    Any other state keeps its reported free ground."""
    if not is_recorded_preview(area):
        return area
    width = required_width_m(family, scale, clearance_m=RIDER_CLEARANCE_M)
    regions = [r for r in area.regions if r.kind not in ("AVAILABLE", "WIDTH_SUFFICIENT")]
    for region, angle, available, free in iter_width_bands(area, blocked):
        for part in get_parts(free):
            if isinstance(part, Polygon) and fit_slots(part, available, width, angle):
                rings = [part.exterior, *part.interiors]
                polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in list(ring.coords)[:-1]] for ring in rings]
                regions.append(region.model_copy(update={"polygon": polygon, "display_polygon": None}))
    return area.model_copy(update={"regions": regions})


