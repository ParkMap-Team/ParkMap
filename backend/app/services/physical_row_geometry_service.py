import hashlib
import json
import math
import os
import tempfile
from pathlib import Path

import numpy as np

from app.models import GroundPlaneCalibration, GroundPlaneHomographyResponse, ParkingCalibration, PhysicalRowGeometryConfig
from app.services.ground_plane_homography_service import transform_point


def measurement_fingerprint(calibration: GroundPlaneCalibration) -> str:
    source = {key: value.model_dump(mode="json") for key, value in sorted(calibration.measured_rows.items())}
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def nearest_polygon_boundary(x: float, y: float, polygon) -> tuple[float, float, float]:
    best = (float("inf"), x, y)
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        dx, dy = end.x - start.x, end.y - start.y
        denominator = dx * dx + dy * dy
        t = 0.0 if denominator <= 1e-15 else max(0.0, min(1.0, ((x - start.x) * dx + (y - start.y) * dy) / denominator))
        nearest_x, nearest_y = start.x + t * dx, start.y + t * dy
        distance = math.hypot(x - nearest_x, y - nearest_y)
        if distance < best[0]:
            best = (distance, nearest_x, nearest_y)
    return best


def derive_row_centerline(polygon) -> tuple[tuple[float, float], tuple[float, float]] | None:
    if len(polygon) != 4:
        return None
    points = [(point.x, point.y) for point in polygon]
    area_twice = sum(points[index][0] * points[(index + 1) % 4][1] - points[(index + 1) % 4][0] * points[index][1] for index in range(4))
    if abs(area_twice) <= 1e-12:
        return None
    edges = [(points[index], points[(index + 1) % 4]) for index in range(4)]
    distance_squared = lambda a, b: (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
    pair_02 = distance_squared(*edges[0]) + distance_squared(*edges[2])
    pair_13 = distance_squared(*edges[1]) + distance_squared(*edges[3])
    side_a, side_b = (edges[0], edges[2]) if pair_02 >= pair_13 else (edges[1], edges[3])
    direct = distance_squared(side_a[0], side_b[0]) + distance_squared(side_a[1], side_b[1])
    crossed = distance_squared(side_a[0], side_b[1]) + distance_squared(side_a[1], side_b[0])
    midpoint = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    start, end = (midpoint(side_a[0], side_b[0]), midpoint(side_a[1], side_b[1])) if direct <= crossed else (midpoint(side_a[0], side_b[1]), midpoint(side_a[1], side_b[0]))
    if distance_squared(start, end) <= 1e-12:
        return None
    return (start, end) if start <= end else (end, start)


class PhysicalRowGeometryService:
    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.config_path = self.config_directory / "physical_row_geometry.json"

    def default(self, calibration: GroundPlaneCalibration) -> PhysicalRowGeometryConfig:
        return PhysicalRowGeometryConfig(camera_id=calibration.camera_id, measurement_source_fingerprint=measurement_fingerprint(calibration), rows={})

    def load(self, calibration: GroundPlaneCalibration) -> PhysicalRowGeometryConfig:
        if not self.config_path.is_file():
            return self.default(calibration)
        with self.config_path.open("r", encoding="utf-8") as file:
            return PhysicalRowGeometryConfig.model_validate(json.load(file))

    def save(self, config: PhysicalRowGeometryConfig) -> PhysicalRowGeometryConfig:
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.config_directory, prefix="physical_row_geometry.", suffix=".tmp", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                json.dump(config.model_dump(mode="json"), temporary, indent=2)
                temporary.write("\n")
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.config_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        with self.config_path.open("r", encoding="utf-8") as file:
            verified = PhysicalRowGeometryConfig.model_validate(json.load(file))
        if verified.model_dump(mode="json") != config.model_dump(mode="json"):
            raise OSError("Physical row endpoint read-back verification failed.")
        return verified

    def response(self, config: PhysicalRowGeometryConfig, calibration: GroundPlaneCalibration, parking: ParkingCalibration, homography: GroundPlaneHomographyResponse) -> dict:
        measurement_current = config.measurement_source_fingerprint == measurement_fingerprint(calibration)
        usable_h = homography.current and homography.status == "VALIDATED" and homography.result is not None
        matrix = np.asarray(homography.result.matrix, dtype=float) if usable_h else None
        threshold = float(os.getenv("PARKMAP_PHYSICAL_ROW_WARNING_RELATIVE_PERCENT", "5.0"))
        rows = []
        for parking_row in parking.rows:
            row_id = parking_row.id
            endpoints = config.rows.get(row_id)
            measured = calibration.measured_rows.get(row_id)
            override_enabled = bool(endpoints and endpoints.override_enabled)
            source = "MANUAL_OVERRIDE" if override_enabled else "DERIVED_FROM_EXISTING_ROW"
            diagnostic = {"row_id": row_id, "status": "NOT_READY", "validation_status": "NOT_CHECKED", "source": source, "manual_override_enabled": override_enabled, "measured_length_m": measured.length_m if measured else None, "measured_width_m": measured.width_m if measured else None, "provenance": measured.provenance if measured else None, "start": None, "end": None, "source_start_image": None, "source_end_image": None, "homography_distance_m": None, "difference_m": None, "absolute_error_m": None, "relative_error_percent": None, "start_metric": None, "clicked_end_metric": None, "measured_model_end_metric": None, "endpoint_discrepancy_m": None, "physical_polygon": None}
            for name in ("start", "end"):
                endpoint = getattr(endpoints, name) if endpoints else None
                if endpoint:
                    distance, nearest_x, nearest_y = nearest_polygon_boundary(endpoint.effective_image.x, endpoint.effective_image.y, parking.parking_roi.polygon)
                    diagnostic[name] = {**endpoint.model_dump(mode="json"), "roi_boundary_distance_normalized": distance, "near_roi_boundary": distance <= 0.02, "nearest_roi_boundary": {"x": nearest_x, "y": nearest_y}}
            source_points = None
            if override_enabled and endpoints and endpoints.start and endpoints.end:
                source_points = ((endpoints.start.effective_image.x, endpoints.start.effective_image.y), (endpoints.end.effective_image.x, endpoints.end.effective_image.y))
            elif not override_enabled and parking_row:
                source_points = derive_row_centerline(parking_row.polygon)
            if source_points:
                diagnostic["source_start_image"] = {"x": source_points[0][0], "y": source_points[0][1]}
                diagnostic["source_end_image"] = {"x": source_points[1][0], "y": source_points[1][1]}
            if source_points and measured and measured.provenance == "MEASURED" and measured.length_m and measured.width_m and matrix is not None:
                start = transform_point(source_points[0][0], source_points[0][1], matrix)
                end = transform_point(source_points[1][0], source_points[1][1], matrix)
                if start and end:
                    distance = math.dist(start, end)
                    if distance <= 1e-10:
                        rows.append(diagnostic)
                        continue
                    difference = distance - measured.length_m
                    ux, uy = (end[0] - start[0]) / distance, (end[1] - start[1]) / distance
                    model_end = (start[0] + ux * measured.length_m, start[1] + uy * measured.length_m)
                    half = measured.width_m / 2
                    perpendicular = (-uy * half, ux * half)
                    polygon = [{"x_m": start[0] + perpendicular[0], "y_m": start[1] + perpendicular[1]}, {"x_m": model_end[0] + perpendicular[0], "y_m": model_end[1] + perpendicular[1]}, {"x_m": model_end[0] - perpendicular[0], "y_m": model_end[1] - perpendicular[1]}, {"x_m": start[0] - perpendicular[0], "y_m": start[1] - perpendicular[1]}]
                    relative = abs(difference) / measured.length_m * 100
                    diagnostic.update(status="PHYSICAL_READY", validation_status="CALIBRATED" if relative <= threshold else "CHECK_MEASUREMENT", homography_distance_m=distance, difference_m=difference, absolute_error_m=abs(difference), relative_error_percent=relative, start_metric={"x_m": start[0], "y_m": start[1]}, clicked_end_metric={"x_m": end[0], "y_m": end[1]}, measured_model_end_metric={"x_m": model_end[0], "y_m": model_end[1]}, endpoint_discrepancy_m=math.dist(end, model_end), physical_polygon=polygon)
            rows.append(diagnostic)
        stale = config.camera_id != calibration.camera_id or not measurement_current or not usable_h
        return {"config": config.model_dump(mode="json"), "status": "STALE" if stale else "CURRENT", "homography_current": usable_h, "measurement_source_current": measurement_current, "warning_relative_percent": threshold, "rows": rows}


physical_row_geometry_service = PhysicalRowGeometryService()
