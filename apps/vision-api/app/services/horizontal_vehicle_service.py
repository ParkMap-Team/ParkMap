"""Display-only horizontal reference vehicles and approximate nearest distances.

Image aspect is not measured ground heading. These results never feed fitting.
"""

import math
from typing import Literal

from pydantic import BaseModel, Field
from shapely.geometry import LineString, Point, box
from shapely.ops import nearest_points

from app.models import MetricGroundPoint
from app.services.camera_projection_service import project_metric_point
from app.services.ground_plane_homography_service import transform_point
from app.services.segmentation_experiment_service import MaskPoint
from app.services.virtual_fitting_service import LENGTH_M, WIDTH_M

ORIENTATION_RATIO_THRESHOLD = 1.15


class HorizontalVehicleClearance(BaseModel):
    detection_id: str
    detection_index: int
    pixel_aspect_ratio: float
    polygon_metric: list[MetricGroundPoint] = []
    polygon_image: list[MaskPoint] | None = None
    nearest_detection_id: str | None = None
    neighbor_polygon_metric: list[MetricGroundPoint] = []
    neighbor_polygon_image: list[MaskPoint] | None = None
    clearance_m: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    line_metric: list[MetricGroundPoint] = []
    line_image: list[MaskPoint] | None = None
    excluded_neighbor_count: int = 0
    measurement_status: Literal["APPROXIMATE_REFERENCE", "OUTSIDE_CALIBRATED_ROI", "PROJECTION_UNAVAILABLE", "NO_COMPARABLE_NEIGHBOR"] = "NO_COMPARABLE_NEIGHBOR"
    reference_width_m: float = WIDTH_M
    reference_length_m: float = LENGTH_M
    basis: Literal["STANDARD_REFERENCE_PIXEL_ORIENTATION_NOT_MEASURED"] = "STANDARD_REFERENCE_PIXEL_ORIENTATION_NOT_MEASURED"
    display_only: Literal[True] = True


def _image_points(points, inverse):
    projected, signs = [], set()
    for point in points:
        denominator = inverse[2][0]*point.x+inverse[2][1]*point.y+inverse[2][2]
        if not math.isfinite(denominator) or abs(denominator) <= 1e-12:
            return None
        signs.add(denominator > 0)
        image = project_metric_point({"x_m": point.x, "y_m": point.y}, inverse)
        if image is None or not (0 <= image["x"] <= 1 and 0 <= image["y"] <= 1):
            return None
        projected.append(MaskPoint(**image))
    return projected if len(signs) == 1 else None


def _metric_points(points):
    return [MetricGroundPoint(x_m=point.x, y_m=point.y) for point in points]


def horizontal_vehicle_clearances(segmentation, matrix, inverse, roi):
    references, output = [], []
    for index, detection in enumerate(segmentation.detections):
        bbox = detection.bbox
        ratio = bbox.width*segmentation.image_width/(bbox.height*segmentation.image_height)
        horizontal = ratio >= ORIENTATION_RATIO_THRESHOLD
        clear_orientation = horizontal or ratio <= 1/ORIENTATION_RATIO_THRESHOLD
        anchor = transform_point(bbox.x+bbox.width/2, bbox.y+bbox.height, matrix)
        reference = None
        if anchor is not None and all(math.isfinite(value) for value in anchor):
            x, y = anchor
            lateral, depth = (LENGTH_M, WIDTH_M) if horizontal else (WIDTH_M, LENGTH_M)
            reference = box(x-lateral/2, y, x+lateral/2, y+depth)
        references.append((reference, clear_orientation))
        if not horizontal:
            continue
        result = HorizontalVehicleClearance(detection_id=f"detection_{index+1}", detection_index=index, pixel_aspect_ratio=ratio)
        output.append(result)
        if reference is None:
            result.measurement_status = "PROJECTION_UNAVAILABLE"
            continue
        points = [Point(x, y) for x, y in list(reference.exterior.coords)[:-1]]
        result.polygon_metric = _metric_points(points)
        result.polygon_image = _image_points(points, inverse)
        if not roi.covers(reference):
            result.measurement_status = "OUTSIDE_CALIBRATED_ROI"
        elif result.polygon_image is None:
            result.measurement_status = "PROJECTION_UNAVAILABLE"

    for result in output:
        if result.measurement_status in {"OUTSIDE_CALIBRATED_ROI", "PROJECTION_UNAVAILABLE"}:
            continue
        own = references[result.detection_index][0]
        comparable = [(own.distance(reference), index, reference) for index, (reference, clear) in enumerate(references)
            if index != result.detection_index and reference is not None and clear and roi.covers(reference)]
        result.excluded_neighbor_count = len(references)-1-len(comparable)
        if not comparable:
            continue
        distance, index, neighbor = min(comparable, key=lambda item: (item[0], item[1]))
        endpoints = nearest_points(own, neighbor)
        result.nearest_detection_id = f"detection_{index+1}"
        neighbor_points = [Point(x, y) for x, y in list(neighbor.exterior.coords)[:-1]]
        result.neighbor_polygon_metric = _metric_points(neighbor_points)
        result.neighbor_polygon_image = _image_points(neighbor_points, inverse)
        result.line_image = _image_points(endpoints, inverse)
        if result.line_image is None or result.neighbor_polygon_image is None:
            result.measurement_status = "PROJECTION_UNAVAILABLE"
            continue
        if distance > 0 and not roi.covers(LineString(endpoints)):
            result.measurement_status = "OUTSIDE_CALIBRATED_ROI"
            continue
        result.measurement_status = "APPROXIMATE_REFERENCE"
        result.clearance_m = distance
        result.line_metric = _metric_points(endpoints)
    return output
