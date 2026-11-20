"""Guard Booth recommendation policy: supported rows, access, route and clearance."""

from datetime import timedelta

from app.models import MetricGroundPoint, MetricPolygon, ParkingAreaLiveState
from app.services.recommendation_fitting import fit_recommendation
from app.services.recommendation_models import GuardBoothFit

AISLES = {"row_2": 10.2, "row_3": 10.2, "row_4": 3.2, "row_5": 3.2}
RIGHT_ACCESS_X = 28.9
ENTRANCE_LANE_Y = -8.0
HOLD_DURATION = timedelta(minutes=2)
GUARD_BOOTH_CLEARANCE_M = 0.05


def fit_recorded_preview(area: ParkingAreaLiveState, family: str, entrance: MetricGroundPoint, scale: float, blocked: list[MetricPolygon] | None = None, preferred: MetricPolygon | None = None) -> GuardBoothFit:
    return fit_recommendation(area, family, entrance, scale, blocked, preferred,
        aisles=AISLES, right_access_x=RIGHT_ACCESS_X, clearance_m=GUARD_BOOTH_CLEARANCE_M,
        entrance_y=ENTRANCE_LANE_Y)
