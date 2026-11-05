"""Conservative local fitting from detections, never from projected object masks."""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel
from shapely.affinity import rotate, translate
from shapely.errors import GEOSException
from shapely.geometry import Point, Polygon, box
from shapely.ops import nearest_points, unary_union

from app.models import (
    Detection,
    DetectionResponse,
    GroundPlaneCalibration,
    MetricGroundPoint,
    ParkingCalibration,
)
from app.services.camera_projection_service import project_metric_point
from app.services.ground_plane_homography_service import (
    GroundPlaneHomographyService,
    transform_point,
)
from app.services.live_state_service import calibration_version
from app.services.motorcycle_reference_sizes import (
    ReferenceDimensions,
    ReferenceSizeRules,
    load_rules,
)
from app.services.parking_analysis_service import (
    _geometry,
    _geometry_to_shapely,
    parking_analysis_service,
)
from app.services.segmentation_experiment_service import (
    MaskPoint,
    SegmentationExperimentResult,
)
from app.services.virtual_fitting_service import (
    FITTING_TOLERANCE_M,
    LENGTH_M,
    WIDTH_M,
    _row_angle,
    validate_witness,
)

MAX_CANDIDATES = 200
VIRTUAL_SLOT_WIDTH_M = 1.


class GapMetricGeometry(BaseModel):
    polygons: list[list[list[MetricGroundPoint]]] = []


class GapOccupancyLayer(BaseModel):
    detection_id: str
    source: Literal["PRIMARY", "SEGMENTATION"]
    geometry: GapMetricGeometry
    roi_geometry: GapMetricGeometry


def _metric_points(coordinates):
    return [MetricGroundPoint(x_m=x, y_m=y) for x, y in coordinates]


class GapFamilyRecommendation(BaseModel):
    family: str
    width_m: float
    width_clearance_m: float
    basis: str


class GapCandidate(BaseModel):
    slot_length_m: float | None = None
    source_gap_width_m: float | None = None
    compatible_families: list[GapFamilyRecommendation] = []
    polygon_metric: list[MetricGroundPoint] = []
    width_line_metric: list[MetricGroundPoint] = []
    label_metric: MetricGroundPoint | None = None
    id: str
    row_id: str
    state: Literal["FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR", "INSUFFICIENT_WIDTH", "UNKNOWN"]
    reasons: list[str]
    gap_width_m: float
    nearest_clearance_m: float | None
    polygon_image: list[MaskPoint] | None
    width_line_image: list[MaskPoint] | None
    nearest_line_image: list[MaskPoint] | None
    label_image: MaskPoint | None


class GapRow(BaseModel):
    polygon_metric: list[MetricGroundPoint] = []
    label_metric: MetricGroundPoint | None = None
    row_id: str
    state: Literal["FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR", "UNKNOWN", "NO_FIT"]
    fit_count: int
    unknown_count: int
    polygon_image: list[MaskPoint] | None = None
    label_image: MaskPoint | None = None


class MeasuredGap(BaseModel):
    row_id: str
    width_m: float
    depth_m: float
    state: Literal["INSUFFICIENT_WIDTH", "INSUFFICIENT_DEPTH", "REQUIRES_FIT_VALIDATION"]
    width_line_image: list[MaskPoint] | None


class IncomingVehicleRecommendation(BaseModel):
    reasons: list[str] = []
    width_m: float
    allocation_width_m: float
    recommended_count: int
    unknown_count: int
    truncated: bool
    candidates: list[GapCandidate]


class SegmentationGapResult(BaseModel):
    incoming_vehicle: IncomingVehicleRecommendation | None = None
    family_recommendation_error: str | None = None
    access_status: Literal["NOT_EVALUATED"] = "NOT_EVALUATED"
    occupied_layers: list[GapOccupancyLayer] = []
    width_measurement: Literal["ROW_MIDLINE_BAND", "FULL_DEPTH"] = "FULL_DEPTH"
    measurement_band_m: float | None = None
    parking_roi_metric: GapMetricGeometry | None = None
    occupied_metric: GapMetricGeometry | None = None
    evaluation_mode: Literal["FULL_FOOTPRINT", "WIDTH_ONLY", "VIRTUAL_SLOTS"] = "FULL_FOOTPRINT"
    status: Literal["EXPERIMENTAL", "CALIBRATION_REQUIRED", "UNKNOWN"] = "EXPERIMENTAL"
    target_width_m: float = WIDTH_M
    target_length_m: float | None = LENGTH_M
    clearance_margin_m: float = 0.
    calibration_source: Literal["MEASURED", "ESTIMATED", "UNKNOWN"] = "UNKNOWN"
    calibration_version: str | None = None
    reasons: list[str] = []
    candidates: list[GapCandidate] = []
    rows: list[GapRow] = []
    measured_gaps: list[MeasuredGap] = []
    green_count: int = 0
    unknown_count: int = 0
    narrow_count: int = 0
    truncated: bool = False


def recommend_families_by_width(result: SegmentationGapResult, rules: ReferenceSizeRules) -> None:
    """Compare exact catalogue widths only; never certify a full vehicle fit."""
    for candidate in result.candidates:
        candidate.compatible_families = []
        if result.evaluation_mode not in {"WIDTH_ONLY", "VIRTUAL_SLOTS"} or candidate.state not in {"WIDTH_SUFFICIENT", "SLOT_CLEAR"}:
            continue
        for family, size in sorted(rules.classes.items(), key=lambda item: (item[1].width_m, item[0])):
            if size.width_m <= candidate.gap_width_m + FITTING_TOLERANCE_M:
                candidate.compatible_families.append(GapFamilyRecommendation(family=family, width_m=size.width_m,
                    width_clearance_m=max(0., candidate.gap_width_m-size.width_m), basis=size.basis))


def _project(coordinates, inverse):
    points, signs = [], set()
    try:
        for x, y in coordinates:
            denominator = inverse[2][0] * x + inverse[2][1] * y + inverse[2][2]
            if not math.isfinite(denominator) or abs(denominator) <= 1e-12:
                return None
            signs.add(denominator > 0)
            point = project_metric_point({"x_m": x, "y_m": y}, inverse)
            if point is None or not (0 <= point["x"] <= 1 and 0 <= point["y"] <= 1):
                return None
            points.append(MaskPoint(**point))
    except (IndexError, TypeError, ValueError):
        return None
    return points if len(signs) == 1 else None


def _parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [part for item in getattr(geometry, "geoms", []) for part in _parts(item)]


def _corridor(footprint, row, roi, occupied):
    angle, origin = _row_angle(row), row.centroid
    def local(shape):
        return rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    candidate, local_row = local(footprint), local(row)
    x1, y1, x2, y2 = candidate.bounds
    left, right = local_row.bounds[0], local_row.bounds[2]
    blocked = local(occupied.union(row.difference(roi))).intersection(box(left, y1, right, y2))
    for part in _parts(blocked):
        if part.area <= 1e-10:
            continue
        if part.bounds[2] <= x1 + FITTING_TOLERANCE_M:
            left = max(left, part.bounds[2])
        elif part.bounds[0] >= x2 - FITTING_TOLERANCE_M:
            right = min(right, part.bounds[0])
        else:
            return 0., []
    endpoints = [rotate(translate(Point(x, (y1 + y2) / 2), origin.x, origin.y), angle, origin=(origin.x, origin.y)) for x in (left, right)]
    return max(0., right-left), [(p.x, p.y) for p in endpoints]


def _measure_row(row_id, row, roi, occupied, inverse, *, width_only=False, placements=None, full_row_depth=False, required_width_m=WIDTH_M):
    angle, origin = _row_angle(row), row.centroid
    def local(shape):
        return rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    left, y1, right, row_top = local(row).bounds
    if full_row_depth:
        y2 = row_top
    elif width_only:
        middle, half_band = (y1 + row_top) / 2, min(.01, (row_top-y1) / 2)
        y1, y2 = middle-half_band, middle+half_band
    else:
        y2 = min(row_top, y1 + LENGTH_M)
    blocked = local(occupied.union(row.difference(roi))).intersection(box(left, y1, right, y2))
    intervals = sorted((part.bounds[0], part.bounds[2]) for part in _parts(blocked) if part.area > 1e-10)
    cursor, gaps = left, []
    for start, end in [*intervals, (right, right)]:
        if start > cursor + FITTING_TOLERANCE_M:
            width, depth = start-cursor, y2-y1
            endpoints = [rotate(translate(Point(x, (y1+y2)/2), origin.x, origin.y), angle, origin=(origin.x, origin.y)) for x in (cursor, start)]
            state = "INSUFFICIENT_DEPTH" if not width_only and depth + FITTING_TOLERANCE_M < LENGTH_M else "INSUFFICIENT_WIDTH" if width + FITTING_TOLERANCE_M < required_width_m else "REQUIRES_FIT_VALIDATION"
            gaps.append(MeasuredGap(row_id=row_id, width_m=width, depth_m=depth, state=state, width_line_image=_project([(p.x, p.y) for p in endpoints], inverse)))
            if placements is not None:
                # One corridor per gap, not a count of motorcycle placements.
                corridor = rotate(translate(box(cursor, y1, start, y2), origin.x, origin.y), angle, origin=(origin.x, origin.y))
                placements.append(corridor)
        cursor = max(cursor, end)
    return gaps


def _split_into_slots(corridors, row, limit, slot_width_m):
    angle, origin = _row_angle(row), row.centroid
    def local(shape):
        return rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    _, bottom, _, top = local(row).bounds
    slots = []
    for corridor in corridors:
        left, _, right, _ = local(corridor).bounds
        count = math.floor((right-left+FITTING_TOLERANCE_M) / slot_width_m)
        for index in range(min(count, limit+1-len(slots))):
            start = left + index*slot_width_m
            shape = rotate(translate(box(start, bottom, start+slot_width_m, top), origin.x, origin.y), angle, origin=(origin.x, origin.y))
            slots.append((shape, right-left, top-bottom))
        if len(slots) > limit:
            break
    return slots


def evaluate_gap_geometry(analysis, inverse, image_occluders, *, evidence_count, calibration_source="UNKNOWN", width_only=False, primary_count=None, virtual_slots=False, slot_width_m=VIRTUAL_SLOT_WIDTH_M):
    if not math.isfinite(slot_width_m) or not VIRTUAL_SLOT_WIDTH_M <= slot_width_m <= 5:
        raise ValueError("Allocated width must be between 1 and 5 metres")
    result = SegmentationGapResult(calibration_source=calibration_source, evaluation_mode="WIDTH_ONLY" if width_only else "FULL_FOOTPRINT")
    if width_only:
        result.width_measurement, result.measurement_band_m = "ROW_MIDLINE_BAND", .02
    if virtual_slots:
        result.evaluation_mode, result.target_width_m, result.target_length_m = "VIRTUAL_SLOTS", slot_width_m, None
        result.width_measurement, result.measurement_band_m = "FULL_DEPTH", None
    if evidence_count == 0:
        result.status, result.reasons = "UNKNOWN", ["NO_SEGMENTATION_EVIDENCE_IN_ROI"]
    roi = _geometry_to_shapely(analysis["physical_map"]["parking_roi"])
    occupied = unary_union([_geometry_to_shapely(item["canonical_footprint"]) for item in analysis["detections"]])
    result.parking_roi_metric = GapMetricGeometry.model_validate(_geometry(roi))
    result.occupied_metric = GapMetricGeometry.model_validate({"polygons": [polygon for item in analysis["detections"] for polygon in item["canonical_footprint"]["polygons"]]})
    for index, item in enumerate(analysis["detections"]):
        shape = _geometry_to_shapely(item["canonical_footprint"])
        clipped = shape.intersection(roi)
        # Boundary-only intersections are not occupied area.
        clipped = unary_union(_parts(clipped))
        source = "PRIMARY" if primary_count is None or index < primary_count else "SEGMENTATION"
        result.occupied_layers.append(GapOccupancyLayer(detection_id=f"{source.lower()}-{index}", source=source,
            geometry=GapMetricGeometry.model_validate(item["canonical_footprint"]), roi_geometry=GapMetricGeometry.model_validate(_geometry(clipped))))
    occluders = unary_union(image_occluders)
    row_shapes = {item["row_id"]: Polygon([(p["x_m"], p["y_m"]) for p in item["polygon"]]) for item in analysis["physical_map"]["rows"]}
    uncertainty = {item["row_id"]: item["status"] for item in analysis["uncertainty"]["rows"]}
    for source in analysis["capacity"]["rows"]:
        row_id = source["row_id"]
        width_corridors = []
        if evidence_count > 0:
            measured = _measure_row(row_id, row_shapes[row_id], row_shapes[row_id] if virtual_slots else roi, occupied, inverse, width_only=width_only or virtual_slots, placements=width_corridors if width_only or virtual_slots else None, full_row_depth=virtual_slots, required_width_m=slot_width_m if virtual_slots else WIDTH_M)
            remaining = MAX_CANDIDATES - len(result.measured_gaps)
            result.measured_gaps.extend(measured[:remaining])
            result.truncated |= len(measured) > remaining
        footprints = width_corridors if width_only else [_geometry_to_shapely(item["footprint_metric"]) for item in source["placements"]]
        slots = _split_into_slots(width_corridors, row_shapes[row_id], MAX_CANDIDATES-len(result.candidates), slot_width_m) if virtual_slots else []
        if virtual_slots:
            footprints = [item[0] for item in slots]
        for index, footprint in enumerate(footprints):
            if len(result.candidates) >= MAX_CANDIDATES:
                result.truncated = True
                break
            row = row_shapes[row_id]
            reasons = list(result.reasons)
            geometry_valid = (footprint.is_valid and footprint.area > 0 and row.buffer(FITTING_TOLERANCE_M).covers(footprint) and footprint.intersection(occupied).area <= 1e-10) if width_only or virtual_slots else (source["validation"]["valid"] and validate_witness(footprint, row, occupied))
            if not geometry_valid or not roi.buffer(FITTING_TOLERANCE_M).covers(footprint):
                reasons.append("FOOTPRINT_NOT_PROVEN")
            if analysis["uncertainty"].get("validation") is not True or uncertainty.get(row_id) != "CLEAR":
                reasons.append("ROW_UNCERTAIN")
            polygon_image = _project(list(footprint.exterior.coords)[:-1], inverse)
            if polygon_image is None:
                reasons.append("PROJECTION_OUTSIDE_VALID_IMAGE")
            else:
                projected = Polygon([(p.x, p.y) for p in polygon_image])
                if not projected.is_valid or projected.area <= 1e-12:
                    reasons.append("INVALID_IMAGE_PROJECTION")
                elif projected.intersection(occluders).area > 1e-10:
                    reasons.append("GROUND_MAY_BE_OCCLUDED")
            width, endpoints = _corridor(footprint, row, roi, occupied)
            if virtual_slots:
                width = slot_width_m
                angle, origin = _row_angle(row), row.centroid
                local_slot = rotate(translate(footprint, -origin.x, -origin.y), -angle, origin=(0, 0))
                left, bottom, right, top = local_slot.bounds
                ends = [rotate(translate(Point(x, (bottom+top)/2), origin.x, origin.y), angle, origin=(origin.x, origin.y)) for x in (left, right)]
                endpoints = [(point.x, point.y) for point in ends]
            width_line = _project(endpoints, inverse) if endpoints else None
            too_narrow = width + FITTING_TOLERANCE_M < WIDTH_M
            if width_only and too_narrow:
                reasons.append("WIDTH_BELOW_TARGET")
            if width_line is None or (too_narrow and not width_only):
                reasons.append("FULL_DEPTH_CORRIDOR_NOT_PROVEN")
            nearest_line = None
            clearance = None
            if not width_only and not virtual_slots and not occupied.is_empty:
                near = nearest_points(footprint, occupied)
                clearance = footprint.distance(occupied)
                nearest_line = _project([(p.x, p.y) for p in near], inverse)
            label = _project([(footprint.centroid.x, footprint.centroid.y)], inverse)
            state = "UNKNOWN" if any(reason != "WIDTH_BELOW_TARGET" for reason in reasons) else "INSUFFICIENT_WIDTH" if too_narrow else "WIDTH_SUFFICIENT" if width_only else "FIT"
            if virtual_slots and not reasons:
                state = "SLOT_CLEAR"
            result.candidates.append(GapCandidate(id=f"{row_id}-{'slot' if virtual_slots else 'gap'}-{index+1}", row_id=row_id, state=state,
                slot_length_m=slots[index][2] if virtual_slots else None, source_gap_width_m=slots[index][1] if virtual_slots else None,
                polygon_metric=_metric_points(list(footprint.exterior.coords)[:-1]), width_line_metric=_metric_points(endpoints), label_metric=MetricGroundPoint(x_m=footprint.centroid.x, y_m=footprint.centroid.y),
                reasons=reasons, gap_width_m=width, nearest_clearance_m=clearance, polygon_image=polygon_image,
                width_line_image=width_line, nearest_line_image=nearest_line, label_image=label[0] if label else None))
        candidates = [item for item in result.candidates if item.row_id == row_id]
        fits = sum(item.state in {"FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR"} for item in candidates)
        unknown = sum(item.state == "UNKNOWN" for item in candidates)
        state = ("SLOT_CLEAR" if virtual_slots else "WIDTH_SUFFICIENT" if width_only else "FIT") if fits else "UNKNOWN" if unknown or result.reasons or uncertainty.get(row_id) != "CLEAR" or result.truncated else "NO_FIT"
        row = row_shapes[row_id]
        outline = _project(list(row.exterior.coords)[:-1], inverse)
        label = _project([(row.centroid.x, row.centroid.y)], inverse)
        result.rows.append(GapRow(row_id=row_id, state=state, fit_count=fits, unknown_count=unknown,
            polygon_metric=_metric_points(list(row.exterior.coords)[:-1]), label_metric=MetricGroundPoint(x_m=row.centroid.x, y_m=row.centroid.y),
            polygon_image=outline, label_image=label[0] if label else None))
    result.green_count = sum(item.state in {"FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR"} for item in result.candidates)
    result.unknown_count = sum(item.state == "UNKNOWN" for item in result.candidates)
    result.narrow_count = sum(item.state == "INSUFFICIENT_WIDTH" for item in result.candidates)
    return result


def analyze_segmentation_gaps(standard: DetectionResponse, segmentation: SegmentationExperimentResult, service=parking_analysis_service, *, reference_sizes=None, incoming_width_m=None):
    if incoming_width_m is not None and (not math.isfinite(incoming_width_m) or not 0 < incoming_width_m <= 5):
        raise ValueError("Incoming width must be positive and at most 5 metres")
    try:
        directory = service.root / "config"
        version = calibration_version(directory)
        ground = GroundPlaneCalibration.model_validate_json((directory / "ground_plane_calibration.json").read_bytes())
        parking = ParkingCalibration.model_validate_json((directory / "parking_calibration.json").read_bytes())
        response = GroundPlaneHomographyService(directory).get_response(ground)
        if not response.current or not response.row_validation_current or response.status != "VALIDATED" or response.result is None or len(ground.control_points) < 4:
            raise ValueError("Current validated calibration required")
        reference = ground.reference_image
        if parking.camera_id != ground.camera_id or parking.reference_image != reference or (reference.width, reference.height) != (standard.image_width, standard.image_height) or (segmentation.image_width, segmentation.image_height) != (standard.image_width, standard.image_height):
            raise ValueError("Frame and camera calibration must match")
        if any(row.id not in ground.measured_rows or ground.measured_rows[row.id].width_m is None or ground.measured_rows[row.id].length_m is None for row in parking.rows):
            raise ValueError("Every row needs metric dimensions")
        matrix = np.asarray(response.result.matrix)
        inverse = np.asarray(response.result.inverse_matrix)
        if matrix.shape != (3, 3) or inverse.shape != (3, 3) or not np.all(np.isfinite(matrix)) or abs(np.linalg.det(matrix)) < 1e-12 or np.linalg.cond(matrix) > 1e12 or not np.allclose(matrix @ inverse, np.eye(3), atol=1e-6):
            raise ValueError("Invalid calibrated transform")
        projected_roi = [transform_point(point.x, point.y, matrix) for point in parking.parking_roi.polygon]
        if any(point is None for point in projected_roi):
            raise ValueError("Invalid current ROI")
        roi = Polygon(projected_roi)
        stored_roi = Polygon([(p.x_m, p.y_m) for p in response.result.roi_metric.points])
        if not roi.is_valid or roi.symmetric_difference(stored_roi).area > 1e-6:
            raise ValueError("ROI changed; recalculate calibration")
        detections = [*standard.detections, *[Detection(class_id=0, class_name="motorcycle", confidence=item.confidence, bbox=item.bbox) for item in segmentation.detections]]
        if len(detections) > 600:
            raise ValueError("Too many detections")
        combined = standard.model_copy(update={"detections": detections, "parking_analysis": None})
        sizes = []
        for index in range(len(detections)):
            known = reference_sizes[index] if reference_sizes is not None and index < len(standard.detections) else None
            sizes.append(ReferenceDimensions(width_m=max(WIDTH_M, known.width_m if known else WIDTH_M),
                length_m=max(LENGTH_M, known.length_m if known else LENGTH_M), basis="CONSERVATIVE_REFERENCE_FOOTPRINT"))
        analysis = service.analyze(combined, reference_sizes=sizes)
        occluders = [box(item.bbox.x, item.bbox.y, item.bbox.x+item.bbox.width, item.bbox.y+item.bbox.height) for item in detections]
        occluders.extend(Polygon([(p.x, p.y) for p in item.polygon]) for item in segmentation.detections if item.polygon)
        evidence = sum(item["inside_parking_roi"] for item in analysis["detections"][len(standard.detections):])
        result = evaluate_gap_geometry(analysis, response.result.inverse_matrix, occluders, evidence_count=evidence, calibration_source=ground.provenance, virtual_slots=True, primary_count=len(standard.detections))
        if incoming_width_m is not None:
            allocated = max(VIRTUAL_SLOT_WIDTH_M, incoming_width_m)
            incoming = evaluate_gap_geometry(analysis, response.result.inverse_matrix, occluders, evidence_count=evidence, calibration_source=ground.provenance, virtual_slots=True, primary_count=len(standard.detections), slot_width_m=allocated)
            result.incoming_vehicle = IncomingVehicleRecommendation(width_m=incoming_width_m, allocation_width_m=allocated,
                reasons=incoming.reasons,
                recommended_count=incoming.green_count, unknown_count=incoming.unknown_count, truncated=incoming.truncated,
                candidates=[item.model_copy(update={"id": f"incoming-{item.id}"}) for item in incoming.candidates])
        try:
            recommend_families_by_width(result, load_rules())
        except (OSError, ValueError):
            result.family_recommendation_error = "Reference-size rules unavailable; check config/motorcycle_reference_sizes.json."
        if calibration_version(directory) != version:
            raise ValueError("Calibration changed during analysis")
        result.calibration_version = version
        return result
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, np.linalg.LinAlgError, GEOSException):
        return SegmentationGapResult(status="CALIBRATION_REQUIRED", evaluation_mode="VIRTUAL_SLOTS", target_width_m=VIRTUAL_SLOT_WIDTH_M, target_length_m=None, reasons=["CURRENT_MATCHING_CALIBRATION_REQUIRED"])
