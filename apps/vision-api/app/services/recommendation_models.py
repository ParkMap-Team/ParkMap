"""Shared recommendation transport types; legacy schema names preserve the API contract."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import UUID4, AfterValidator, AwareDatetime, BaseModel

from app.models import MetricGroundPoint, MetricPolygon
from app.services.motorcycle_reference_sizes import load_rules


def _configured_family(family: str) -> str:
    if family not in load_rules().classes:
        raise ValueError("Family has no configured reference size.")
    return family


PreviewFamily = Annotated[str, AfterValidator(_configured_family)]


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


