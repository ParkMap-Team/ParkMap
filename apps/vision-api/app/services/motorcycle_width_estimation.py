"""Approximate bbox spans for display and the opt-in operator width experiment."""

import math
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from app.models import DetectionBBox
from app.services.ground_plane_calibration_service import GroundPlaneCalibrationService
from app.services.ground_plane_homography_service import (
    GroundPlaneHomographyService,
    transform_point,
)


def estimate_width_m(bbox: DetectionBBox, image_width: int, image_height: int, matrix: np.ndarray) -> float | None:
    """Estimate a lateral image span using local ground scale at the bbox bottom.

    This ports the legacy +/-16 pixel homography experiment. A camera bbox is
    not a measured body/mirror width, even when the ground calibration is measured.
    """
    if image_width <= 0 or image_height <= 0 or matrix.shape != (3, 3) or not np.all(np.isfinite(matrix)):
        return None
    if abs(np.linalg.det(matrix)) < 1e-12 or np.linalg.cond(matrix) > 1e12:
        return None
    x, y = bbox.x + bbox.width / 2, bbox.y + bbox.height
    delta = 16 / image_width
    if not delta <= x <= 1 - delta or not 0 <= y <= 1:
        return None
    points = [transform_point(px, y, matrix) for px in (x, x - delta, x + delta)]
    if any(point is None for point in points):
        return None
    local_scale = math.dist(points[1], points[2]) / 32
    estimate = bbox.width * image_width * local_scale
    return estimate if math.isfinite(estimate) and 0 < estimate <= 3 else None


def estimate_widths(boxes: Sequence[DetectionBBox], image_width: int, image_height: int,
                    config_directory: Path) -> dict[int, float]:
    """Return estimates only for a current calibration of this frame's resolution."""
    try:
        ground = GroundPlaneCalibrationService(config_directory).load()
        response = GroundPlaneHomographyService(config_directory).get_response(ground)
        if (not response.current or not response.row_validation_current or response.status != "VALIDATED"
                or response.result is None
                or (ground.reference_image.width, ground.reference_image.height) != (image_width, image_height)):
            return {}
        matrix = np.asarray(response.result.matrix, dtype=float)
        return {index: width for index, box in enumerate(boxes)
                if (width := estimate_width_m(box, image_width, image_height, matrix)) is not None}
    except (OSError, ValueError, TypeError, np.linalg.LinAlgError):
        # A failed display estimate must not stop standard geometry publication.
        return {}
