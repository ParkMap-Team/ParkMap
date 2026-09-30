import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.models import GroundPlaneCalibration, GroundPlaneHomographyResponse, GroundPlaneHomographyResult, GroundPlaneMetricPoint, GroundPlaneMetricPolygon, GroundPlanePointDiagnostic, ParkingCalibration


class HomographyInputError(ValueError):
    pass


def source_fingerprint(calibration: GroundPlaneCalibration) -> str:
    source = {
        "camera_id": calibration.camera_id,
        "reference_image": calibration.reference_image.model_dump(mode="json"),
        "control_points": [point.model_dump(mode="json") for point in calibration.control_points],
    }
    encoded = json.dumps(source, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def row_measurements_fingerprint(calibration: GroundPlaneCalibration) -> str:
    encoded = json.dumps({key: value.model_dump(mode="json") for key, value in sorted(calibration.measured_rows.items())}, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalize(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    center = points.mean(axis=0)
    shifted = points - center
    mean_distance = np.linalg.norm(shifted, axis=1).mean()
    if not np.isfinite(mean_distance) or mean_distance < 1e-12:
        raise HomographyInputError("Control points are degenerate.")
    scale = math.sqrt(2.0) / mean_distance
    transform = np.array([[scale, 0.0, -scale * center[0]], [0.0, scale, -scale * center[1]], [0.0, 0.0, 1.0]])
    homogeneous = np.column_stack((points, np.ones(len(points))))
    normalized = (transform @ homogeneous.T).T
    return normalized[:, :2], transform


def _validate_points(image: np.ndarray, ground: np.ndarray) -> None:
    if len(image) < 4:
        raise HomographyInputError("At least four valid MEASURED control points are required.")
    if len(np.unique(image, axis=0)) != len(image) or len(np.unique(ground, axis=0)) != len(ground):
        raise HomographyInputError("Duplicate image or ground coordinates are not allowed.")
    if np.linalg.matrix_rank(np.column_stack((image, np.ones(len(image))))) < 3 or np.linalg.matrix_rank(np.column_stack((ground, np.ones(len(ground))))) < 3:
        raise HomographyInputError("Control points are collinear or degenerate.")


def calculate_homography(image: np.ndarray, ground: np.ndarray) -> np.ndarray:
    _validate_points(image, ground)
    image_n, image_t = _normalize(image)
    ground_n, ground_t = _normalize(ground)
    rows = []
    for (x, y), (u, v) in zip(image_n, ground_n, strict=True):
        rows.extend(([-x, -y, -1.0, 0.0, 0.0, 0.0, u * x, u * y, u], [0.0, 0.0, 0.0, -x, -y, -1.0, v * x, v * y, v]))
    design = np.asarray(rows, dtype=float)
    if np.linalg.matrix_rank(design) < 8:
        raise HomographyInputError("Control-point configuration cannot determine a homography.")
    _, _, vt = np.linalg.svd(design)
    normalized_h = vt[-1].reshape(3, 3)
    matrix = np.linalg.inv(ground_t) @ normalized_h @ image_t
    if abs(matrix[2, 2]) > 1e-12:
        matrix /= matrix[2, 2]
    else:
        matrix /= np.linalg.norm(matrix)
    if not np.all(np.isfinite(matrix)) or abs(np.linalg.det(matrix)) < 1e-12 or np.linalg.cond(matrix) > 1e12:
        raise HomographyInputError("Calculated homography is singular or numerically unstable.")
    return matrix


def transform_point(x: float, y: float, matrix: np.ndarray) -> tuple[float, float] | None:
    projected = matrix @ np.array([x, y, 1.0])
    if not np.all(np.isfinite(projected)) or abs(projected[2]) < 1e-10:
        return None
    result = projected[:2] / projected[2]
    if not np.all(np.isfinite(result)):
        return None
    return float(result[0]), float(result[1])


def _metric_polygon(identifier: str, points, matrix: np.ndarray, measured=None) -> GroundPlaneMetricPolygon:
    transformed = [transform_point(point.x, point.y, matrix) for point in points]
    if any(point is None for point in transformed):
        raise HomographyInputError(f"{identifier} contains a vertex that cannot be projected.")
    metric = np.asarray(transformed, dtype=float)
    centered = metric - metric.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    axes = vt if len(vt) == 2 else np.eye(2)
    extents = np.ptp(centered @ axes.T, axis=0)
    longitudinal, cross = sorted((float(extents[0]), float(extents[1])), reverse=True)
    length = measured.length_m if measured else None
    width = measured.width_m if measured else None
    return GroundPlaneMetricPolygon(id=identifier, points=[GroundPlaneMetricPoint(x_m=x, y_m=y) for x, y in transformed], longitudinal_extent_m=longitudinal, cross_extent_m=cross, measured_length_m=length, measured_width_m=width, length_difference_m=longitudinal - length if length else None, width_difference_m=cross - width if width else None)


class GroundPlaneHomographyService:
    def __init__(self, config_directory: Path | None = None) -> None:
        self.config_directory = config_directory or Path(__file__).resolve().parents[2] / "config"
        self.result_path = self.config_directory / "ground_plane_homography.json"

    def load(self) -> GroundPlaneHomographyResult | None:
        if not self.result_path.is_file():
            return None
        with self.result_path.open("r", encoding="utf-8") as file:
            return GroundPlaneHomographyResult.model_validate(json.load(file))

    def get_response(self, calibration: GroundPlaneCalibration) -> GroundPlaneHomographyResponse:
        result = self.load()
        if result is None:
            return GroundPlaneHomographyResponse(status="INPUT_NOT_READY" if sum(p.provenance == "MEASURED" for p in calibration.control_points) < 4 else "CALCULATED", current=False, row_validation_current=False, message="No calculated homography is stored.")
        current = result.source_calibration_fingerprint == source_fingerprint(calibration)
        if not current:
            return GroundPlaneHomographyResponse(status="STALE", current=False, row_validation_current=False, message="Source control points or camera identity changed. Recalculate before using metric geometry.", result=result.model_copy(update={"status": "STALE"}))
        row_current = result.row_measurements_fingerprint == row_measurements_fingerprint(calibration)
        message = "Homography is current for the saved measured inputs." if row_current else "Homography is current, but physical row measurements changed; recalculate to refresh row comparisons."
        return GroundPlaneHomographyResponse(status=result.status, current=True, row_validation_current=row_current, message=message, result=result)

    def calculate(self, calibration: GroundPlaneCalibration, parking: ParkingCalibration) -> GroundPlaneHomographyResponse:
        points = [point for point in calibration.control_points if point.provenance == "MEASURED"]
        image = np.asarray([[point.image_x, point.image_y] for point in points], dtype=float)
        ground = np.asarray([[point.ground_x_m, point.ground_y_m] for point in points], dtype=float)
        matrix = calculate_homography(image, ground)
        inverse = np.linalg.inv(matrix)
        if not np.all(np.isfinite(inverse)):
            raise HomographyInputError("Calculated homography has no usable inverse.")
        diagnostics = []
        errors = []
        for point in points:
            projected = transform_point(point.image_x, point.image_y, matrix)
            if projected is None:
                raise HomographyInputError(f"Control point {point.id} cannot be projected.")
            error_x, error_y = projected[0] - point.ground_x_m, projected[1] - point.ground_y_m
            error = math.hypot(error_x, error_y)
            errors.append(error)
            diagnostics.append(GroundPlanePointDiagnostic(id=point.id, measured_x_m=point.ground_x_m, measured_y_m=point.ground_y_m, projected_x_m=projected[0], projected_y_m=projected[1], error_x_m=error_x, error_y_m=error_y, error_m=error, inlier=True))
        rmse = math.sqrt(sum(error * error for error in errors) / len(errors))
        warning_rmse = float(os.getenv("PARKMAP_HOMOGRAPHY_WARNING_RMSE_M", "0.50"))
        warning_max = float(os.getenv("PARKMAP_HOMOGRAPHY_WARNING_MAX_ERROR_M", "1.00"))
        if len(points) == 4:
            result_status = "CALCULATED"
        elif rmse <= warning_rmse and max(errors) <= warning_max:
            result_status = "VALIDATED"
        else:
            result_status = "VALIDATION_WARNING"
        roi = _metric_polygon("parking_roi", parking.parking_roi.polygon, matrix)
        rows = [_metric_polygon(row.id, row.polygon, matrix, calibration.measured_rows.get(row.id)) for row in parking.rows]
        result = GroundPlaneHomographyResult(camera_id=calibration.camera_id, source_calibration_fingerprint=source_fingerprint(calibration), row_measurements_fingerprint=row_measurements_fingerprint(calibration), matrix=matrix.tolist(), inverse_matrix=inverse.tolist(), control_point_count=len(points), inlier_count=len(points), rmse_m=rmse, mean_error_m=float(np.mean(errors)), median_error_m=float(np.median(errors)), max_error_m=max(errors), warning_rmse_m=warning_rmse, warning_max_error_m=warning_max, status=result_status, calculated_at=datetime.now(timezone.utc), point_diagnostics=diagnostics, roi_metric=roi, rows_metric=rows)
        self.config_directory.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.config_directory, prefix="ground_plane_homography.", suffix=".tmp", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                json.dump(result.model_dump(mode="json"), temporary, indent=2)
                temporary.write("\n")
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.result_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        verified = self.load()
        if verified is None or verified.model_dump(mode="json") != result.model_dump(mode="json"):
            raise OSError("Homography result read-back verification failed.")
        return GroundPlaneHomographyResponse(status=verified.status, current=True, row_validation_current=True, message="Homography calculated, persisted, and verified.", result=verified)


ground_plane_homography_service = GroundPlaneHomographyService()
