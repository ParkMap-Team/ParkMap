"""Local operator-owned LINE route templates, separate from parking eligibility."""

import hashlib
import os
import tempfile
from pathlib import Path
from threading import RLock
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import LotModelResponse, MetricGroundPoint
from app.services.recommendation_models import RowRoutePreview

RowId = Literal["row_1", "row_2", "row_3", "row_4", "row_5"]


class RouteWaypoint(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    x_m: float = Field(ge=-1000, le=1000, allow_inf_nan=False)
    y_m: float = Field(ge=-1000, le=1000, allow_inf_nan=False)


class RoutePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    waypoints: Annotated[list[RouteWaypoint], Field(min_length=1, max_length=32)]
    entry: Literal["vertical", "horizontal", "direct"] = "vertical"

    @model_validator(mode="after")
    def distinct_adjacent_points(self):
        if any(a == b for a, b in zip(self.waypoints, self.waypoints[1:])):
            raise ValueError("Adjacent route points must differ")
        return self


class RouteConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: Literal["sripatum"] = "sripatum"
    rows: dict[RowId, RoutePlan]

    @model_validator(mode="after")
    def all_rows(self):
        if set(self.rows) != {f"row_{i}" for i in range(1, 6)}:
            raise ValueError("Configure all five rows")
        return self


class RouteSettingsState(BaseModel):
    revision: str
    configuration: RouteConfiguration | None


class RouteWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: str = Field(min_length=1, max_length=64)
    expected_lot_version: int = Field(ge=1, strict=True)
    configuration: RouteConfiguration


class RouteEditorState(BaseModel):
    revision: str
    configuration: RouteConfiguration
    defaults: RouteConfiguration
    lot_model: LotModelResponse
    entrance: MetricGroundPoint
    previews: list[RowRoutePreview]


class RouteConflict(ValueError):
    pass


class RouteSettingsUnavailable(RuntimeError):
    pass


class RouteSettings:
    """Atomic local-file persistence; one API process, optimistic editor revisions."""

    def __init__(self, directory: Path):
        self.path = directory / "line_routes.json"
        self.lock = RLock()

    def read(self) -> RouteSettingsState:
        with self.lock:
            try:
                try:
                    raw = self.path.read_bytes()
                except FileNotFoundError:
                    return RouteSettingsState(revision="default", configuration=None)
                if len(raw) > 64 * 1024:
                    raise ValueError("Route configuration is too large")
                return RouteSettingsState(revision=hashlib.sha256(raw).hexdigest(),
                                          configuration=RouteConfiguration.model_validate_json(raw))
            except (OSError, ValueError) as error:
                raise RouteSettingsUnavailable("Saved LINE routes are unavailable; review the local route configuration") from error

    def save(self, configuration: RouteConfiguration, expected_revision: str) -> RouteSettingsState:
        with self.lock:
            if self.read().revision != expected_revision:
                raise RouteConflict("Routes changed in another tab; reload before saving")
            configuration = RouteConfiguration.model_validate(configuration.model_dump())
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                                 prefix="line_routes.", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(configuration.model_dump_json(indent=2) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
            return self.read()


def build_route(entrance: MetricGroundPoint, destination: MetricGroundPoint, plan: RoutePlan) -> list[MetricGroundPoint]:
    points = [MetricGroundPoint(x_m=p.x_m, y_m=p.y_m) for p in plan.waypoints]
    last = points[-1]
    if plan.entry == "vertical":
        points.append(MetricGroundPoint(x_m=destination.x_m, y_m=last.y_m))
    elif plan.entry == "horizontal":
        points.append(MetricGroundPoint(x_m=last.x_m, y_m=destination.y_m))
    return [entrance, *points, destination]


route_settings = RouteSettings(Path(__file__).resolve().parents[2] / "config")
