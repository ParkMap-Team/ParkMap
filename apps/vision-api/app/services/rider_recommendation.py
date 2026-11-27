"""LIFF recommendation policy, independently configurable from Guard Booth."""

from datetime import timedelta

from shapely.geometry import Polygon

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services import rider_map_fitting
from app.services.recommendation_fitting import fit_recommendation
from app.services.recommendation_models import GuardBoothFit, RowRoutePreview
from app.services.route_configuration import (
    RouteConfiguration,
    RoutePlan,
    build_route,
    route_settings,
)

# Row E continues along the right access, then approaches from above the lot.
AISLES = {"row_1": 15.0, "row_2": 10.2, "row_3": 10.2, "row_4": 3.2, "row_5": 3.2}
RIGHT_ACCESS_X = 28.9
ENTRANCE_LANE_Y = -8.0
HOLD_DURATION = timedelta(minutes=2)


def default_routes(entrance: MetricGroundPoint) -> RouteConfiguration:
    return RouteConfiguration(rows={row_id: RoutePlan.model_validate({"waypoints": [
        {"x_m": entrance.x_m, "y_m": ENTRANCE_LANE_Y},
        {"x_m": RIGHT_ACCESS_X, "y_m": ENTRANCE_LANE_Y},
        {"x_m": RIGHT_ACCESS_X, "y_m": aisle},
    ]}) for row_id, aisle in AISLES.items()})


def preview_routes(rows: dict[str, Polygon], entrance: MetricGroundPoint,
                   configuration: RouteConfiguration | None = None) -> list[RowRoutePreview]:
    """Static row-centre route diagnostics; no availability check or hold allocation."""
    configuration = configuration or route_settings.read().configuration or default_routes(entrance)
    return [RowRoutePreview(row_id=row_id, label=label, route=build_route(
        entrance, MetricGroundPoint(x_m=rows[row_id].centroid.x, y_m=rows[row_id].centroid.y), configuration.rows[row_id],
    )) for row_id, label in zip(AISLES, "EDCBA", strict=True)
        if row_id in rows and rows[row_id].is_valid and not rows[row_id].is_empty]


def fit_recorded_preview(area: ParkingAreaLiveState, family: str, entrance: MetricGroundPoint, scale: float, blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None, *, target: MetricGroundPoint | None = None) -> GuardBoothFit:
    configuration = route_settings.read().configuration
    return fit_recommendation(area, family, entrance, scale, blocked, preferred,
        aisles=AISLES, right_access_x=RIGHT_ACCESS_X, clearance_m=rider_map_fitting.RIDER_CLEARANCE_M,
        entrance_y=ENTRANCE_LANE_Y, routes=configuration.rows if configuration else None, target=target)
