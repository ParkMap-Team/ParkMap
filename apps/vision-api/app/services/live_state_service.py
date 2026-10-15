"""Live parking state: build worker publications and decide what readers may see."""

from __future__ import annotations

import hashlib
import math
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import ValidationError
from shapely.geometry import Polygon
from shapely.ops import unary_union

from app.models import (
    GroundMeasurementSource,
    GroundPlaneCalibration,
    LiveRegion,
    LotModelDefinition,
    MetricGroundPoint,
    MetricPolygon,
    MotorcycleProxy,
    ParkingAreaLiveState,
    ParkingStatePublish,
    StateSourceKind,
)

# Files consumed by parking_analysis_service, in a fixed order.
CALIBRATION_FILES = ("ground_plane_homography.json", "ground_plane_calibration.json", "parking_calibration.json")
MAX_FUTURE_SKEW_S = 5.0


class CalibrationFilesUnavailableError(RuntimeError):
    """The calibration files needed for analysis are missing."""


def _read_calibration(config_directory: Path) -> dict[str, bytes]:
    contents = {}
    for name in CALIBRATION_FILES:
        try:
            contents[name] = (config_directory / name).read_bytes()
        except OSError as error:
            raise CalibrationFilesUnavailableError(f"Calibration file is unavailable: {name}") from error
    return contents


def _fingerprint(contents: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name in CALIBRATION_FILES:
        digest.update(name.encode())
        digest.update(len(contents[name]).to_bytes(8, "big"))
        digest.update(contents[name])
    return f"files-sha256:{digest.hexdigest()}"


def calibration_version(config_directory: Path) -> str:
    """Fingerprint the calibration inputs so readers can reject states from another calibration."""
    return _fingerprint(_read_calibration(config_directory))


def calibration_identity(config_directory: Path) -> tuple[str, GroundMeasurementSource]:
    """Version and provenance of one read of the calibration files, so the two always describe the same inputs."""
    contents = _read_calibration(config_directory)
    try:
        ground = GroundPlaneCalibration.model_validate_json(contents["ground_plane_calibration.json"])
    except ValidationError as error:
        raise CalibrationFilesUnavailableError(f"Calibration file is invalid: ground_plane_calibration.json ({error.error_count()} errors)") from error
    return _fingerprint(contents), ground.provenance


def _points(ring: list[dict[str, float]]) -> list[MetricGroundPoint]:
    return [MetricGroundPoint(x_m=point["x_m"], y_m=point["y_m"]) for point in ring]


def _polygons(geometry: dict[str, Any] | None) -> list[MetricPolygon]:
    return [[_points(ring) for ring in rings] for rings in (geometry or {}).get("polygons", []) if rings]


def _proxy(detection: dict[str, Any]) -> MotorcycleProxy | None:
    shapes = _polygons(detection.get("canonical_footprint"))
    if len(shapes) != 1:
        return None
    footprint = Polygon([(point.x_m, point.y_m) for point in shapes[0][0]])
    # Shapely 2.1's minimum rotated rectangle emits numpy divide/invalid warnings from
    # intermediate values; the returned rectangle is correct, so silence only those.
    with np.errstate(divide="ignore", invalid="ignore"):
        rectangle = footprint.minimum_rotated_rectangle
    corners = list(rectangle.exterior.coords)[:4]
    if len(corners) < 4:
        return None
    edges = [(corners[index], corners[(index + 1) % 4]) for index in range(2)]
    lengths = [math.dist(start, end) for start, end in edges]
    long_index = 0 if lengths[0] >= lengths[1] else 1
    (start_x, start_y), (end_x, end_y) = edges[long_index]
    if min(lengths) <= 0.0:
        return None
    return MotorcycleProxy(
        detection_id=detection["detection_id"],
        center=MetricGroundPoint(x_m=rectangle.centroid.x, y_m=rectangle.centroid.y),
        heading_rad=math.atan2(end_y - start_y, end_x - start_x),
        length_m=lengths[long_index],
        width_m=lengths[1 - long_index],
        confidence=detection["confidence"],
    )


def build_state_publish(
    analysis: dict[str, Any],
    *,
    parking_area_id: str,
    source: StateSourceKind,
    observed_at: datetime,
    processed_at: datetime,
    calibration_version: str,
    calibration_provenance: GroundMeasurementSource,
) -> ParkingStatePublish:
    """Map one parking analysis to the live contract, marking every unproven row UNKNOWN.

    A row is only allowed to show green or yellow when the parking-state decision for
    that row is valid and not UNCERTAIN, and the capacity witness for the row is valid.
    A live camera on an ESTIMATED calibration proves no row; it publishes diagnostics only.
    """
    parking_state = analysis.get("parking_state") or {}
    state_rows = {row["row_id"]: row for row in parking_state.get("rows", [])}
    capacity_rows = {row.get("row_id"): row for row in (analysis.get("capacity") or {}).get("rows", [])}
    overall_valid = parking_state.get("validation") is True and not (source == "LIVE_CAMERA" and calibration_provenance == "ESTIMATED")

    regions: list[LiveRegion] = []
    for row in analysis["physical_map"]["rows"]:
        row_id = row["row_id"]
        decision = state_rows.get(row_id)
        capacity = capacity_rows.get(row_id, {})
        trusted = (
            overall_valid
            and decision is not None
            and decision.get("validation") is True
            and decision.get("state") != "UNCERTAIN"
            and capacity.get("validation", {}).get("valid") is True
        )
        if not trusted:
            regions.append(LiveRegion(kind="UNKNOWN", row_id=row_id, polygon=[_points(row["polygon"])]))
            continue
        for placement in capacity.get("placements", []):
            regions.extend(LiveRegion(kind="AVAILABLE", row_id=row_id, polygon=polygon) for polygon in _polygons(placement.get("footprint_metric")))
        for placement in analysis.get("almost_available_placements", []):
            if placement.get("row_id") == row_id:
                regions.extend(LiveRegion(kind="ALMOST_AVAILABLE", row_id=row_id, polygon=polygon) for polygon in _polygons(placement.get("footprint_metric")))

    motorcycles = [proxy for detection in analysis.get("detections", []) if detection.get("inside_parking_roi") and (proxy := _proxy(detection)) is not None]
    return ParkingStatePublish(
        parking_area_id=parking_area_id,
        camera_id=analysis["camera_id"],
        source=source,
        observed_at=observed_at,
        processed_at=processed_at,
        calibration_version=calibration_version,
        calibration_provenance=calibration_provenance,
        analysis_version=analysis["analysis_version"],
        regions=regions,
        motorcycles=motorcycles,
    )


def evaluate_area_state(
    parking_area_id: str,
    *,
    stored: ParkingStatePublish | None,
    active_calibration_version: str | None,
    now: datetime,
    freshness_limit_s: float,
) -> ParkingAreaLiveState:
    """Decide what a reader may see. Anything not proven current is returned without regions.

    A still-image loop shows recorded photos, so its freshness is the age of the processing,
    and a fresh loop is DEMO rather than LIVE. Every other source ages from its observation.
    """
    if active_calibration_version is None:
        return ParkingAreaLiveState(parking_area_id=parking_area_id, status="NOT_CALIBRATED")
    if stored is None:
        return ParkingAreaLiveState(parking_area_id=parking_area_id, status="NO_DATA")
    still_image = stored.source == "STILL_IMAGE_LOOP"
    age_s = (now - (stored.processed_at if still_image else stored.observed_at)).total_seconds()
    base = {"parking_area_id": parking_area_id, "source": stored.source, "observed_at": stored.observed_at, "processed_at": stored.processed_at, "age_s": age_s}
    if stored.calibration_version != active_calibration_version:
        return ParkingAreaLiveState(**base, status="CALIBRATION_MISMATCH")
    if age_s > freshness_limit_s or age_s < -MAX_FUTURE_SKEW_S:
        return ParkingAreaLiveState(**base, status="STALE")
    return ParkingAreaLiveState(**base, status="DEMO" if still_image else "LIVE", regions=stored.regions, motorcycles=stored.motorcycles)


def _shape(polygon: MetricPolygon) -> Polygon:
    rings = [[(point.x_m, point.y_m) for point in ring] for ring in polygon]
    return Polygon(rings[0], rings[1:])


def validate_lot_model(definition: LotModelDefinition) -> None:
    """Reject lot models whose areas overlap or leave the outline."""
    outline = _shape(definition.outline)
    if not outline.is_valid or outline.area <= 0.0:
        raise ValueError("Lot model outline must be a valid polygon with positive area.")
    areas = []
    for area in definition.parking_areas:
        shape = _shape(area.polygon)
        if not shape.is_valid or shape.area <= 0.0:
            raise ValueError(f"Parking area {area.parking_area_id} must be a valid polygon with positive area.")
        if not outline.buffer(1e-6).covers(shape):
            raise ValueError(f"Parking area {area.parking_area_id} must lie inside the lot outline.")
        if any(shape.intersection(other).area > 1e-6 for other in areas):
            raise ValueError(f"Parking area {area.parking_area_id} overlaps another parking area.")
        areas.append(shape)


def unmonitored_polygons(definition: LotModelDefinition) -> list[MetricPolygon]:
    """Ground inside the lot outline that no parking area covers."""
    remainder = _shape(definition.outline).difference(unary_union([_shape(area.polygon) for area in definition.parking_areas]))
    if remainder.is_empty:
        return []
    parts = [remainder] if remainder.geom_type == "Polygon" else [part for part in getattr(remainder, "geoms", []) if part.geom_type == "Polygon"]
    output: list[MetricPolygon] = []
    for part in parts:
        rings = [list(part.exterior.coords)[:-1], *[list(hole.coords)[:-1] for hole in part.interiors]]
        output.append([[MetricGroundPoint(x_m=x, y_m=y) for x, y in ring] for ring in rings])
    return output
