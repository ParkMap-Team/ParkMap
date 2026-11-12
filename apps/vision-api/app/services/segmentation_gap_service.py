"""Conservative local fitting from detections, never from projected object masks."""

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel
from shapely.affinity import rotate, scale, translate
from shapely.errors import GEOSException
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union

from app.models import (
    Detection,
    DetectionResponse,
    GroundPlaneCalibration,
    MetricGroundPoint,
    ParkingCalibration,
)
from app.services.almost_available_service import (
    ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO,
    small_occupied_conflict_ratio,
)
from app.services.camera_projection_service import project_metric_point
from app.services.ground_plane_homography_service import (
    GroundPlaneHomographyService,
    transform_point,
)
from app.services.horizontal_vehicle_service import (
    ORIENTATION_RATIO_THRESHOLD,
    HorizontalVehicleClearance,
    horizontal_vehicle_clearances,
)
from app.services.live_state_service import calibration_version
from app.services.motorcycle_reference_sizes import (
    ReferenceDimensions,
    ReferenceSizeRules,
    load_rules,
)
from app.services.parking_analysis_service import (
    ParkingAnalysisService,
    _geometry,
    _geometry_to_shapely,
    parking_analysis_service,
)
from app.services.segmentation_experiment_service import (
    MaskPoint,
    SegmentationExperimentResult,
)
from app.services.uncertainty_service import calculate_uncertainty
from app.services.virtual_fitting_service import (
    FITTING_TOLERANCE_M,
    LENGTH_M,
    WIDTH_M,
    _row_angle,
    validate_witness,
)
from app.services.visible_gap_geometry import (
    patch_width_witness,
    transform_polygon,
    visible_ground_patches,
)

MAX_CANDIDATES = 200
MAX_OCCLUSION_EVIDENCE = 12
VIRTUAL_SLOT_WIDTH_M = 1.
ADVISORY_MAX_EXTRA_WIDTH_M = .10
MASK_ROW_MIN_OVERLAP_RATIO = .10
NEAREST_ROW_MAX_DISTANCE_M = .20
NEAREST_ROW_MIN_LEAD_M = .10
MASK_SUPPORTED_ROI_TOLERANCE_M = .40


class GapMetricGeometry(BaseModel):
    polygons: list[list[list[MetricGroundPoint]]] = []


class GapImageGeometry(BaseModel):
    polygons: list[list[list[MaskPoint]]] = []


class GapOccupancyLayer(BaseModel):
    detection_id: str
    detection_index: int | None = None
    assigned_row_id: str | None = None
    row_assignment_source: Literal["BOTTOM_CENTRE", "NEAREST_APPROXIMATE", "BOTTOM_EDGE_APPROXIMATE", "MASK_SUPPORTED_NEAREST_EDGE", "IMAGE_POINT", "IMAGE_MASK", "IMAGE_NEAREST_EDGE", "UNRESOLVED"] = "UNRESOLVED"
    row_assignment_distance_m: float | None = None
    row_assignment_reason: str = "UNRESOLVED"
    source: Literal["PRIMARY", "SEGMENTATION"]
    geometry: GapMetricGeometry
    roi_geometry: GapMetricGeometry
    row_depth_geometry: GapMetricGeometry | None = None


def _row_depth_display(shape, rows, roi):
    """Display-only lateral occupied bands; never feed these into fitting."""
    bands = []
    for row in rows.values():
        within = shape.intersection(row)
        angle, origin = _row_angle(row), row.centroid
        local_row = rotate(translate(row, -origin.x, -origin.y), -angle, origin=(0, 0))
        _, bottom, _, top = local_row.bounds
        for part in _parts(within):
            if part.area <= 1e-10:
                continue
            local = rotate(translate(part, -origin.x, -origin.y), -angle, origin=(0, 0))
            left, _, right, _ = local.bounds
            band = translate(rotate(box(left, bottom, right, top), angle, origin=(0, 0)), origin.x, origin.y)
            bands.extend(_parts(band.intersection(row).intersection(roi)))
    return GapMetricGeometry.model_validate(_geometry(unary_union(bands)))


def _metric_points(coordinates):
    return [MetricGroundPoint(x_m=x, y_m=y) for x, y in coordinates]


class GapFamilyRecommendation(BaseModel):
    family: str
    width_m: float
    width_clearance_m: float
    basis: str


class GapNearFit(BaseModel):
    required_extra_width_m: float
    occupied_overlap_ratio: float
    conflicting_detection_ids: list[str]
    target_polygon_metric: list[MetricGroundPoint]
    target_polygon_image: list[MaskPoint]
    movement_status: Literal["NOT_COMPUTED"] = "NOT_COMPUTED"


class GapOrientationHypothesis(BaseModel):
    detection_id: str
    detection_index: int
    pixel_aspect_ratio: float
    image_orientation: Literal["HORIZONTAL_IMAGE", "VERTICAL_IMAGE", "AMBIGUOUS_IMAGE"]
    proposed_rotation_deg: Literal[0, 90] | None
    geometry: GapMetricGeometry | None = None
    image_geometry: GapImageGeometry | None = None
    basis: Literal["PIXEL_BBOX_RATIO_NOT_GROUND_HEADING"] = "PIXEL_BBOX_RATIO_NOT_GROUND_HEADING"


class GapImageSource(BaseModel):
    detection_id: str
    detection_index: int
    source_kind: Literal["MASK", "BBOX_FALLBACK"]


class GapOcclusionEvidence(GapImageSource):
    candidate_overlap_ratio: float
    overlap_image: GapImageGeometry


class GapCandidate(BaseModel):
    width_blocking_detection_ids: list[str] = []
    geometry_metric: GapMetricGeometry | None = None
    geometry_image: GapImageGeometry | None = None
    visibility: Literal["VISIBLE", "OCCLUDED", "UNCONFIRMED"] = "UNCONFIRMED"
    depth_at_width_midpoint_m: float | None = None
    depth_line_metric: list[MetricGroundPoint] = []
    depth_line_image: list[MaskPoint] | None = None
    occlusion_evidence_available: bool = False
    occlusion_evidence_truncated: bool = False
    occlusion_evidence: list[GapOcclusionEvidence] = []
    near_fit: GapNearFit | None = None
    width_check: Literal["SUFFICIENT", "INSUFFICIENT", "NOT_EVALUATED"] = "NOT_EVALUATED"
    uncertain_detection_ids: list[str] = []
    slot_length_m: float | None = None
    source_gap_width_m: float | None = None
    compatible_families: list[GapFamilyRecommendation] = []
    polygon_metric: list[MetricGroundPoint] = []
    width_line_metric: list[MetricGroundPoint] = []
    label_metric: MetricGroundPoint | None = None
    id: str
    row_id: str
    state: Literal["FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR", "INSUFFICIENT_WIDTH", "ALMOST_AVAILABLE", "UNKNOWN"]
    reasons: list[str]
    gap_width_m: float
    nearest_clearance_m: float | None
    polygon_image: list[MaskPoint] | None
    width_line_image: list[MaskPoint] | None
    nearest_line_image: list[MaskPoint] | None
    label_image: MaskPoint | None


class GapRow(BaseModel):
    bottom_edge_metric: list[MetricGroundPoint] = []
    bottom_edge_image: list[MaskPoint] | None = None
    almost_count: int = 0
    uncertainty_scope: Literal["ROW", "LOCAL_REFERENCE_ENVELOPE", "NONE"] = "ROW"
    reasons: list[str] = []
    affected_detection_ids: list[str] = []
    polygon_metric: list[MetricGroundPoint] = []
    label_metric: MetricGroundPoint | None = None
    row_id: str
    state: Literal["FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR", "ALMOST_AVAILABLE", "UNKNOWN", "NO_FIT"]
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
    almost_count: int = 0
    reasons: list[str] = []
    width_m: float
    allocation_width_m: float
    recommended_count: int
    unknown_count: int
    truncated: bool
    candidates: list[GapCandidate]


class GapUncertaintyRegion(BaseModel):
    detection_id: str
    reasons: list[str]
    geometry: GapMetricGeometry


class GapBackgroundRegion(BaseModel):
    image_geometry: GapImageGeometry | None = None
    occlusion_evidence_available: bool = False
    occlusion_evidence_truncated: bool = False
    occlusion_evidence: list[GapOcclusionEvidence] = []
    depth_blockers: list[GapImageSource] = []
    depth_blockers_truncated: bool = False
    id: str
    row_id: str
    kind: Literal["OCCUPIED_REFERENCE", "NOT_EVALUATED"]
    reasons: list[str]
    detection_ids: list[str] = []
    geometry: GapMetricGeometry


class GapDetectionRowAssignment(BaseModel):
    detection_id: str
    assigned_row_id: str | None = None
    ground_point: MetricGroundPoint | None = None
    distance_m: float | None = None
    reason: str = "UNRESOLVED"
    nearest_row_id: str | None = None
    distance_line_metric: list[MetricGroundPoint] = []
    distance_line_image: list[MaskPoint] | None = None


class SegmentationGapResult(BaseModel):
    horizontal_vehicles: list[HorizontalVehicleClearance] = []
    detection_row_assignments: list[GapDetectionRowAssignment] = []
    uncertain_reference_ids: list[str] = []
    row_owned_references: bool = False
    occupancy_scope: Literal["REFERENCE_OVERLAP", "GROUND_ANCHOR_IN_ROW_AND_ROI", "GROUND_ANCHOR_OR_ROW_MASK", "BOTTOM_EDGE_ANCHOR", "IMAGE_ROW_POINT_OR_MASK", "IMAGE_NEAREST_LOWER_EDGE"] = "REFERENCE_OVERLAP"
    excluded_detection_ids: list[str] = []
    orientation_hypotheses: list[GapOrientationHypothesis] = []
    orientation_ratio_threshold: float = ORIENTATION_RATIO_THRESHOLD
    orientation_display_only: Literal[True] = True
    background_regions: list[GapBackgroundRegion] = []
    almost_count: int = 0
    advisory_max_extra_width_m: float = ADVISORY_MAX_EXTRA_WIDTH_M
    advisory_max_overlap_ratio: float = ALMOST_AVAILABLE_MAX_OCCUPIED_OVERLAP_RATIO
    occupancy_source: Literal["COMBINED", "SEGMENTATION_ONLY"] = "COMBINED"
    uncertainty_regions: list[GapUncertaintyRegion] = []
    incoming_vehicle: IncomingVehicleRecommendation | None = None
    family_recommendation_error: str | None = None
    access_status: Literal["NOT_EVALUATED"] = "NOT_EVALUATED"
    occupied_layers: list[GapOccupancyLayer] = []
    width_measurement: Literal["ROW_MIDLINE_BAND", "FULL_DEPTH", "VISIBLE_PATCH_CROSS_SECTION"] = "FULL_DEPTH"
    measurement_band_m: float | None = None
    parking_roi_metric: GapMetricGeometry | None = None
    occupied_metric: GapMetricGeometry | None = None
    evaluation_mode: Literal["FULL_FOOTPRINT", "WIDTH_ONLY", "VIRTUAL_SLOTS", "CONTINUOUS_GAPS", "VISIBLE_FREE_SHAPES"] = "FULL_FOOTPRINT"
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
        if result.evaluation_mode not in {"WIDTH_ONLY", "VIRTUAL_SLOTS", "CONTINUOUS_GAPS", "VISIBLE_FREE_SHAPES"} or candidate.state not in {"WIDTH_SUFFICIENT", "SLOT_CLEAR"}:
            continue
        for family, size in sorted(rules.classes.items(), key=lambda item: (item[1].width_m, item[0])):
            if size.width_m + result.clearance_margin_m <= candidate.gap_width_m + FITTING_TOLERANCE_M:
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


def _image_geometry(shape):
    return GapImageGeometry(polygons=[[
        [MaskPoint(x=min(1., max(0., x)), y=min(1., max(0., y))) for x, y in list(ring.coords)[:-1]]
        for ring in [part.exterior, *part.interiors]] for part in _parts(shape)])


def build_bbox_orientation_hypothesis(bbox, image_width, image_height, reference_geometry, inverse, detection_id, detection_index):
    """Display-only 0/90 degree proposal; image aspect is not ground heading."""
    width, height = bbox.width*image_width, bbox.height*image_height
    if not all(math.isfinite(value) and value > 0 for value in (width, height)):
        raise ValueError("Orientation preview needs positive pixel dimensions")
    ratio = width/height
    orientation = "HORIZONTAL_IMAGE" if ratio >= ORIENTATION_RATIO_THRESHOLD else "VERTICAL_IMAGE" if ratio <= 1/ORIENTATION_RATIO_THRESHOLD else "AMBIGUOUS_IMAGE"
    angle = 90 if orientation == "HORIZONTAL_IMAGE" else 0 if orientation == "VERTICAL_IMAGE" else None
    result = GapOrientationHypothesis(detection_id=detection_id, detection_index=detection_index,
        pixel_aspect_ratio=ratio, image_orientation=orientation, proposed_rotation_deg=angle)
    if angle is None:
        return result
    reference = _geometry_to_shapely(reference_geometry)
    proposed = rotate(reference, angle, origin="centroid")
    result.geometry = GapMetricGeometry.model_validate(_geometry(proposed))
    projected = []
    for part in _parts(proposed):
        rings = [_project(list(ring.coords)[:-1], inverse) for ring in [part.exterior, *part.interiors]]
        if any(ring is None for ring in rings):
            return result
        projected.append(rings)
    result.image_geometry = GapImageGeometry(polygons=projected)
    return result


def _overlap_diagnostics(projected, details):
    if projected is None or not projected.is_valid or projected.area <= 1e-12 or details is None:
        return False, [], False
    evidence = []
    for index, kind, shape in details:
        overlap = projected.intersection(shape)
        if overlap.area <= 1e-10:
            continue
        if len(evidence) >= MAX_OCCLUSION_EVIDENCE:
            return True, evidence, True
        evidence.append(GapOcclusionEvidence(detection_id=f"detection_{index+1}", detection_index=index,
            source_kind=kind, candidate_overlap_ratio=min(1., overlap.area/projected.area), overlap_image=_image_geometry(overlap)))
    return True, evidence, False


def _describe_background(row_id, row, roi, occupied, candidates, layers, reason, inverse, image_occluder_details):
    evaluated = unary_union([_geometry_to_shapely(item.geometry_metric.model_dump()) if item.geometry_metric is not None else Polygon([(point.x_m, point.y_m) for point in item.polygon_metric]) for item in candidates])
    background = row.intersection(roi).difference(evaluated)
    sources = [(item.detection_index if item.detection_index is not None else index, item.detection_id, _geometry_to_shapely(item.roi_geometry.model_dump())) for index, item in enumerate(layers) if item.assigned_row_id is None or item.assigned_row_id == row_id]
    kinds = {index: kind for index, kind, _ in image_occluder_details or []}
    angle, origin = _row_angle(row), row.centroid
    def local(shape):
        return rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    output = []
    for kind, shape in [("OCCUPIED_REFERENCE", background.intersection(occupied)), ("NOT_EVALUATED", background.difference(occupied))]:
        for index, part in enumerate(_parts(shape)):
            if part.area <= 1e-10:
                continue
            ids = sorted({key for _, key, source in sources if part.intersection(source).area > 1e-10}) if kind == "OCCUPIED_REFERENCE" else []
            rings = [_project(list(ring.coords)[:-1], inverse) for ring in [part.exterior, *part.interiors]]
            projected = None if any(ring is None for ring in rings) else Polygon([(p.x, p.y) for p in rings[0]], [[(p.x, p.y) for p in ring] for ring in rings[1:]])
            available, evidence, truncated = _overlap_diagnostics(projected, image_occluder_details)
            blockers = []
            if kind == "NOT_EVALUATED" and reason == "NO_FULL_DEPTH_CANDIDATE":
                left, _, right, _ = local(part).bounds
                for source_index, key, source in sources:
                    within = source.intersection(row)
                    if within.area <= 1e-10:
                        continue
                    source_left, _, source_right, _ = local(within).bounds
                    if min(right, source_right)-max(left, source_left) > FITTING_TOLERANCE_M:
                        blockers.append(GapImageSource(detection_id=key, detection_index=source_index, source_kind=kinds.get(source_index, "BBOX_FALLBACK")))
            output.append(GapBackgroundRegion(id=f"{row_id}-background-{kind.lower()}-{index+1}", row_id=row_id,
                image_geometry=_image_geometry(projected) if projected is not None and projected.is_valid else None,
                occlusion_evidence_available=available, occlusion_evidence=evidence, occlusion_evidence_truncated=truncated,
                depth_blockers=blockers[:MAX_OCCLUSION_EVIDENCE], depth_blockers_truncated=len(blockers)>MAX_OCCLUSION_EVIDENCE,
                kind=kind, reasons=[] if kind == "OCCUPIED_REFERENCE" else [reason], detection_ids=ids,
                geometry=GapMetricGeometry.model_validate(_geometry(part))))
    return output


def _segmentation_occluders(segmentation):
    """Image-space masks only; a missing/unusable mask conservatively uses its box."""
    output = []
    tolerance = max(1 / segmentation.image_width, 1 / segmentation.image_height)
    for index, item in enumerate(segmentation.detections):
        bounds = box(item.bbox.x, item.bbox.y, item.bbox.x+item.bbox.width, item.bbox.y+item.bbox.height)
        shape = None
        if item.polygon and len(item.polygon) >= 3:
            candidate = Polygon([(point.x, point.y) for point in item.polygon])
            if candidate.is_valid and candidate.area > 1e-12 and bounds.buffer(tolerance).covers(candidate):
                shape = candidate
        output.append((index, "MASK" if shape is not None else "BBOX_FALLBACK", shape if shape is not None else bounds))
    return output


def _assignment_uncertainty(analysis):
    """Bound assignment-only ambiguity under the existing reference-size/anchor model.

    The circular envelope contains every heading of the reference rectangle about
    its anchor. It is an experimental bound, not a measured vehicle footprint.
    Unknown causes, unresolved detections or invalid transforms keep the row gate.
    """
    allowed = {"AMBIGUOUS_ROW_ASSIGNMENT", "UNASSIGNED_ROW_INTERSECTION"}
    detections = {item.get("detection_id"): item for item in analysis["detections"]}
    regions, localized_rows = {}, set()
    for row in analysis["uncertainty"]["rows"]:
        reasons, ids = row.get("reasons", []), row.get("affected_detection_ids", [])
        if row["status"] != "UNCERTAIN" or row.get("validation") is False or not reasons or not set(reasons) <= allowed or not ids:
            continue
        pending = {}
        for detection_id in ids:
            item = detections.get(detection_id)
            try:
                if item is None or item.get("transform_valid") is not True:
                    break
                anchor = item["metric_ground_point"]
                size = item.get("reference_size", {"width_m": WIDTH_M, "length_m": LENGTH_M})
                x, y, width, length = anchor["x_m"], anchor["y_m"], size["width_m"], size["length_m"]
                if not all(math.isfinite(v) for v in (x, y, width, length)) or min(width, length) <= 0:
                    break
                # Slightly circumscribe the true circle instead of an inscribed approximation.
                envelope = Point(x, y).buffer(math.hypot(width/2, length)*1.001, quad_segs=32)
                footprint = _geometry_to_shapely(item["canonical_footprint"])
                if footprint.is_empty or not footprint.is_valid or not envelope.covers(footprint):
                    break
                pending[detection_id] = (envelope, sorted(set(reasons)))
            except (KeyError, TypeError, ValueError, GEOSException):
                break
        else:
            localized_rows.add(row["row_id"])
            for detection_id, (envelope, causes) in pending.items():
                previous = regions.get(detection_id)
                regions[detection_id] = (envelope, sorted(set(causes + (previous[1] if previous else []))))
    return regions, localized_rows


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


def _near_fit_width(footprint, row, roi, occupied, analysis, regions, required_width, inverse, occluders):
    """A target with one small known occupied conflict, not a movement instruction."""
    angle, origin = _row_angle(row), row.centroid
    local = rotate(translate(footprint, -origin.x, -origin.y), -angle, origin=(0, 0))
    left, bottom, right, top = local.bounds
    deficit = required_width-(right-left)
    if not FITTING_TOLERANCE_M < deficit <= ADVISORY_MAX_EXTRA_WIDTH_M + FITTING_TOLERANCE_M:
        return None
    for start in (left, right-required_width):
        target = rotate(translate(box(start, bottom, start+required_width, top), origin.x, origin.y), angle, origin=(origin.x, origin.y))
        if not row.buffer(FITTING_TOLERANCE_M).covers(target) or not roi.buffer(FITTING_TOLERANCE_M).covers(target):
            continue
        if any(target.intersection(envelope).area > 1e-10 for envelope, _ in regions.values()):
            continue
        ratio = small_occupied_conflict_ratio(target, occupied)
        if ratio is None:
            continue
        blockers = [item.get("detection_id", f"detection_{index+1}") for index, item in enumerate(analysis["detections"])
            if target.intersection(_geometry_to_shapely(item["canonical_footprint"])).area > 1e-10]
        if len(blockers) != 1:
            continue
        # Never waive visibility for ground in the expanded target. The known
        # occupied strip is the conflict, not evidence of visible empty ground.
        visible = True
        for free_part in _parts(target.difference(occupied)):
            rings = [_project(list(ring.coords)[:-1], inverse) for ring in [free_part.exterior, *free_part.interiors]]
            if any(ring is None for ring in rings):
                visible = False
                break
            image_free = Polygon([(p.x, p.y) for p in rings[0]], [[(p.x, p.y) for p in ring] for ring in rings[1:]])
            if not image_free.is_valid or image_free.intersection(occluders).area > 1e-10:
                visible = False
                break
        if not visible:
            continue
        projected = _project(list(target.exterior.coords)[:-1], inverse)
        if projected is not None:
            return GapNearFit(required_extra_width_m=deficit, occupied_overlap_ratio=ratio,
                conflicting_detection_ids=blockers, target_polygon_metric=_metric_points(list(target.exterior.coords)[:-1]), target_polygon_image=projected)
    return None


def _evaluate_visible_rows(result, analysis, inverse, roi, occupied, occluders, rows, uncertainty, details, regions, localized_rows, evidence_count, occluder_details, near_fit_advisories, occupied_by_row=None):
    required = result.target_width_m + result.clearance_margin_m
    uncertain_geometry = unary_union([shape for shape, _ in regions.values()])
    for row_id, row in rows.items():
        if occupied_by_row is not None:
            occupied = occupied_by_row[row_id]
        patches = visible_ground_patches(row.intersection(roi).difference(occupied), inverse, occluders, uncertain_geometry)
        for patch in patches:
            if len(result.candidates) >= MAX_CANDIDATES:
                result.truncated = True
                break
            shape = patch.geometry
            reasons = list(dict.fromkeys([*result.reasons, *patch.reasons]))
            if not row.buffer(FITTING_TOLERANCE_M).covers(shape) or not roi.buffer(FITTING_TOLERANCE_M).covers(shape) or shape.intersection(occupied).area > 1e-8:
                reasons.append("FOOTPRINT_NOT_PROVEN")
            if analysis["uncertainty"].get("validation") is not True or (uncertainty.get(row_id) != "CLEAR" and row_id not in localized_rows):
                reasons.extend(["ROW_UNCERTAIN", *details.get(row_id, {}).get("reasons", [])])
            affected = [key for key, (envelope, _) in sorted(regions.items()) if shape.intersection(envelope).area > 1e-10]
            if affected and "LOCAL_ROW_UNCERTAINTY" not in reasons:
                reasons.append("LOCAL_ROW_UNCERTAINTY")
            projected = transform_polygon(shape, inverse, image_bounds=True)
            if projected is None:
                reasons.append("PROJECTION_OUTSIDE_VALID_IMAGE")
            elif projected.intersection(occluders).area > 1e-10 and "GROUND_MAY_BE_OCCLUDED" not in reasons:
                reasons.append("GROUND_MAY_BE_OCCLUDED")
            available, evidence, truncated = _overlap_diagnostics(projected, occluder_details)
            witness = patch_width_witness(shape, row)
            sufficient = witness.width_m + FITTING_TOLERANCE_M >= required and witness.depth_m > 1e-9
            narrow = witness.upper_bound_m + FITTING_TOLERANCE_M < required
            if not sufficient:
                reasons.append("WIDTH_BELOW_TARGET" if narrow else "WIDTH_NOT_PROVEN")
            state = "UNKNOWN" if any(reason != "WIDTH_BELOW_TARGET" for reason in reasons) else "INSUFFICIENT_WIDTH" if narrow else "WIDTH_SUFFICIENT"
            near_fit = None
            if state == "INSUFFICIENT_WIDTH" and near_fit_advisories:
                angle, origin = _row_angle(row), row.centroid
                local = rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
                x1, y1, x2, y2 = local.bounds
                if abs(local.area-(x2-x1)*(y2-y1)) <= 1e-8:
                    near_fit = _near_fit_width(shape, row, roi, occupied, analysis, regions, required, inverse, occluders)
                    if near_fit:
                        state = "ALMOST_AVAILABLE"
                        reasons.append("SMALL_OCCUPIED_CONFLICT")
            label = Point((witness.line[0][0]+witness.line[1][0])/2, (witness.line[0][1]+witness.line[1][1])/2) if witness.line else shape.representative_point()
            label_image = _project([(label.x, label.y)], inverse)
            result.candidates.append(GapCandidate(id=f"{row_id}-patch-{len(result.candidates)+1}", row_id=row_id,
                state=state, reasons=list(dict.fromkeys(reasons)), gap_width_m=witness.width_m,
                width_check="SUFFICIENT" if sufficient else "INSUFFICIENT" if narrow else "NOT_EVALUATED",
                geometry_metric=GapMetricGeometry.model_validate(_geometry(shape)), geometry_image=_image_geometry(projected) if projected is not None else None,
                visibility="UNCONFIRMED" if projected is None else "OCCLUDED" if "GROUND_MAY_BE_OCCLUDED" in reasons else patch.visibility, depth_at_width_midpoint_m=witness.depth_m,
                depth_line_metric=_metric_points(witness.depth_line), depth_line_image=_project(witness.depth_line, inverse) if witness.depth_line else None,
                polygon_metric=_metric_points(list(shape.exterior.coords)[:-1]), polygon_image=_project(list(shape.exterior.coords)[:-1], inverse),
                width_line_metric=_metric_points(witness.line), width_line_image=_project(witness.line, inverse) if witness.line else None,
                label_metric=MetricGroundPoint(x_m=label.x, y_m=label.y), label_image=label_image[0] if label_image else None,
                nearest_clearance_m=None, nearest_line_image=None, near_fit=near_fit, uncertain_detection_ids=affected,
                occlusion_evidence_available=available, occlusion_evidence=evidence, occlusion_evidence_truncated=truncated))
        candidates = [item for item in result.candidates if item.row_id == row_id]
        green = sum(item.state == "WIDTH_SUFFICIENT" for item in candidates)
        almost = sum(item.state == "ALMOST_AVAILABLE" for item in candidates)
        unknown = sum(item.state == "UNKNOWN" for item in candidates)
        row_state = "WIDTH_SUFFICIENT" if green else "ALMOST_AVAILABLE" if almost else "UNKNOWN" if unknown or result.reasons or uncertainty.get(row_id) != "CLEAR" or result.truncated else "NO_FIT"
        label = row.representative_point()
        projected_label = _project([(label.x, label.y)], inverse)
        result.rows.append(GapRow(row_id=row_id, state=row_state, fit_count=green, almost_count=almost, unknown_count=unknown,
            uncertainty_scope="LOCAL_REFERENCE_ENVELOPE" if row_id in localized_rows else "NONE" if uncertainty.get(row_id) == "CLEAR" else "ROW",
            reasons=details.get(row_id, {}).get("reasons", []), affected_detection_ids=details.get(row_id, {}).get("affected_detection_ids", []),
            polygon_metric=_metric_points(list(row.exterior.coords)[:-1]), polygon_image=_project(list(row.exterior.coords)[:-1], inverse),
            label_metric=MetricGroundPoint(x_m=label.x, y_m=label.y), label_image=projected_label[0] if projected_label else None))
        background_reason = "CANDIDATE_LIMIT_REACHED" if result.truncated else "NO_CANDIDATE_AT_LOCATION"
        result.background_regions.extend(_describe_background(row_id, row, roi, occupied, candidates, result.occupied_layers, background_reason, inverse, occluder_details))
    result.green_count = sum(item.state == "WIDTH_SUFFICIENT" for item in result.candidates)
    result.almost_count = sum(item.state == "ALMOST_AVAILABLE" for item in result.candidates)
    result.unknown_count = sum(item.state == "UNKNOWN" for item in result.candidates)
    result.narrow_count = sum(item.state == "INSUFFICIENT_WIDTH" for item in result.candidates)
    return result


def _width_blocking_ids(candidate, row, row_id, analysis, owners, row_owned):
    angle, origin = _row_angle(row), row.centroid
    def local(shape):
        return rotate(translate(shape, -origin.x, -origin.y), -angle, origin=(0, 0))
    left, bottom, right, top = local(candidate).bounds
    output = []
    for index, item in enumerate(analysis["detections"]):
        if row_owned and owners[index] is not None and owners[index] != row_id:
            continue
        shape = _geometry_to_shapely(item["canonical_footprint"])
        for part in _parts(local(shape.intersection(row))):
            x1, y1, x2, y2 = part.bounds
            if min(top, y2)-max(bottom, y1) > 1e-8 and (abs(x2-left) <= 1e-6 or abs(x1-right) <= 1e-6):
                if item.get("detection_id"):
                    output.append(item["detection_id"])
                break
    return sorted(set(output))


def _anchor_row(point, rows, roi):
    """Bounded, tentative nearest-row association; containment always wins."""
    distances = sorted((point.distance(row), key) for key, row in rows.items())
    if not distances:
        return None, "UNRESOLVED", None
    distance, key = distances[0]
    if not roi.covers(point):
        return None, "UNRESOLVED", distance
    containing = [key for key, row in rows.items() if row.covers(point)]
    if len(containing) == 1:
        return containing[0], "BOTTOM_CENTRE", 0.
    if containing:
        return None, "UNRESOLVED", 0.
    if distance <= NEAREST_ROW_MAX_DISTANCE_M + 1e-9 and (len(distances) == 1 or distances[1][0]-distance >= NEAREST_ROW_MIN_LEAD_M-1e-9):
        return key, "NEAREST_APPROXIMATE", distance
    return None, "UNRESOLVED", distance


def _bottom_edge_row(point, edges, roi):
    return _bottom_edge_assignment(point, edges, roi)[:3]


def _eligible_edge_distances(point, edges):
    distances = []
    for key, edge in edges.items():
        start, end = np.asarray(edge.coords[0]), np.asarray(edge.coords[-1])
        direction = end-start
        denominator = float(direction @ direction)
        if denominator <= 1e-12:
            continue
        t = float((np.array([point.x, point.y])-start) @ direction / denominator)
        if 0 <= t <= 1:
            distances.append((point.distance(edge), key))
    return sorted(distances)


def _bottom_edge_assignment(point, edges, roi):
    """Distance to finite lower segments, rejecting points beyond row width."""
    distances = _eligible_edge_distances(point, edges)
    if not distances:
        return None, "UNRESOLVED", None, "OUTSIDE_ROW_SPAN"
    distance, key = distances[0]
    if not roi.covers(point):
        return None, "UNRESOLVED", distance, "OUTSIDE_ROI"
    if distance > NEAREST_ROW_MAX_DISTANCE_M+1e-9:
        return None, "UNRESOLVED", distance, "TOO_FAR_FROM_EDGE"
    if len(distances) > 1 and distances[1][0]-distance < NEAREST_ROW_MIN_LEAD_M-1e-9:
        return None, "UNRESOLVED", distance, "AMBIGUOUS_NEAREST_EDGE"
    return key, "BOTTOM_EDGE_APPROXIMATE", distance, "ASSIGNED"


def _row_distance_witness(point, edges, inverse, selected_row=None):
    """Expose the same nearest finite edge used by association, even if rejected."""
    distances = _eligible_edge_distances(point, edges)
    if not distances and selected_row is None:
        return {}
    key = selected_row if selected_row is not None else distances[0][1]
    edge = edges[key]
    target = edge.interpolate(edge.project(point))
    coordinates = [(point.x, point.y), (target.x, target.y)]
    return {"nearest_row_id": key, "distance_line_metric": _metric_points(coordinates),
        "distance_line_image": _project(coordinates, inverse)}


def _supported_bottom_edge_assignment(point, edges, roi, rows, supported_rows):
    strict = _bottom_edge_assignment(point, edges, roi)
    if strict[3] not in {"TOO_FAR_FROM_EDGE", "OUTSIDE_ROI"}:
        return strict
    distances = _eligible_edge_distances(point, edges)
    distance, key = distances[0]
    # Never switch to a more distant row just because its image mask overlaps.
    if key not in supported_rows:
        return strict
    if len(distances) > 1 and distances[1][0]-distance < NEAREST_ROW_MIN_LEAD_M-1e-9:
        return None, "UNRESOLVED", distance, "AMBIGUOUS_NEAREST_EDGE"
    if strict[3] == "OUTSIDE_ROI":
        tolerance = MASK_SUPPORTED_ROI_TOLERANCE_M+1e-9
        if roi.distance(point) <= tolerance and rows[key].distance(point) <= tolerance and distance <= tolerance:
            return key, "MASK_SUPPORTED_NEAREST_EDGE", distance, "ASSIGNED_NEAR_ROI_WITH_MASK"
        return strict
    if not rows[key].covers(point):
        return strict
    start, end = edges[key].coords[0], edges[key].coords[-1]
    angle = math.degrees(math.atan2(end[1]-start[1], end[0]-start[0]))
    local_row = rotate(rows[key], -angle, origin=rows[key].centroid)
    _, bottom, _, top = local_row.bounds
    if distance > (top-bottom)/2+1e-9:
        return strict
    return key, "MASK_SUPPORTED_NEAREST_EDGE", distance, "ASSIGNED_WITH_MASK"


def _owned_row_band(point, row, edge, roi, width):
    """One lateral reference width centred at the anchor, confined to its owner."""
    if not math.isfinite(width) or width <= 0 or width > 5:
        raise ValueError("Invalid row reference width")
    start, end = edge.coords[0], edge.coords[-1]
    angle = math.degrees(math.atan2(end[1]-start[1], end[0]-start[0]))
    origin = row.centroid
    local_row = rotate(translate(row, -origin.x, -origin.y), -angle, origin=(0, 0))
    local_point = rotate(translate(point, -origin.x, -origin.y), -angle, origin=(0, 0))
    _, bottom, _, top = local_row.bounds
    band = translate(rotate(box(local_point.x-width/2, bottom, local_point.x+width/2, top), angle, origin=(0, 0)), origin.x, origin.y)
    return band.intersection(row).intersection(roi)


def _row_bottom_edges(parking, matrix):
    """Lower means larger image Y, independent of polygon winding or metric Y."""
    output = {}
    for row in parking.rows:
        points = [(p.x, p.y) for p in row.polygon]
        if len(points) != 4:
            raise ValueError("Bottom-edge row assignment requires quadrilateral rows")
        edges = [(points[i], points[(i+1) % 4]) for i in range(4)]
        def pixels(edge):
            a, b = edge
            return math.hypot((b[0]-a[0])*parking.reference_image.width, (b[1]-a[1])*parking.reference_image.height)
        pair = [edges[0], edges[2]] if pixels(edges[0])+pixels(edges[2]) >= pixels(edges[1])+pixels(edges[3]) else [edges[1], edges[3]]
        lower = max(pair, key=lambda edge: (edge[0][1]+edge[1][1])/2)
        projected = [transform_point(x, y, matrix) for x, y in lower]
        if any(point is None for point in projected):
            raise ValueError("Invalid lower-edge projection")
        output[row.id] = LineString(projected)
    return output


def _nearest_image_edge_assignment(bbox, edges, rows, image_width, image_height, roi_distance_m):
    """Choose one lower image segment; distances in metres do not rank rows."""
    if roi_distance_m > MASK_SUPPORTED_ROI_TOLERANCE_M+1e-9:
        return None, "UNRESOLVED", "OUTSIDE_ROI"
    point = Point((bbox.x+bbox.width/2)*image_width, (bbox.y+bbox.height)*image_height)
    ranked = []
    for key, edge in edges.items():
        pixel_edge = scale(edge, xfact=image_width, yfact=image_height, origin=(0, 0))
        start, end = pixel_edge.coords[0], pixel_edge.coords[-1]
        dx, dy = end[0]-start[0], end[1]-start[1]
        if pixel_edge.length <= 1e-9:
            continue
        fraction = ((point.x-start[0])*dx+(point.y-start[1])*dy)/(dx*dx+dy*dy)
        if not -1e-9 <= fraction <= 1+1e-9:
            continue
        pixel_row = scale(rows[key], xfact=image_width, yfact=image_height, origin=(0, 0))
        depth = pixel_row.area/pixel_edge.length
        ranked.append((point.distance(pixel_edge), key, depth))
    ranked.sort()
    if not ranked:
        return None, "UNRESOLVED", "OUTSIDE_ROW_SPAN"
    # A small image-depth-relative lead avoids jitter at the halfway boundary.
    if len(ranked) > 1 and ranked[1][0]-ranked[0][0] <= .05*min(ranked[0][2], ranked[1][2])+1e-9:
        return None, "UNRESOLVED", "AMBIGUOUS_IMAGE_EDGES"
    return ranked[0][1], "IMAGE_NEAREST_EDGE", "ASSIGNED_BY_NEAREST_IMAGE_EDGE"


def _scope_row_references(analysis, rows, roi, originals, bottom_edges=None, row_mask_support=None, image_row_assignments=None):
    """Keep uncertain vehicles; mask ownership never establishes metric certainty."""
    scoped, owners, evidence = [], [], []
    valid = analysis["uncertainty"].get("validation") is True
    for item, shape in zip(analysis["detections"], originals, strict=True):
        owner = None
        source, distance = "UNRESOLVED", None
        reason = "UNRESOLVED"
        uncertain = True
        try:
            anchor = item["metric_ground_point"]
            coordinates = (anchor["x_m"], anchor["y_m"])
            if item.get("transform_valid") is not True or not all(math.isfinite(v) for v in coordinates) or not shape.is_valid or shape.is_empty:
                raise ValueError("Invalid reference anchor")
            point = Point(coordinates)
            if image_row_assignments is not None:
                proposed, source, reason = image_row_assignments.get(item.get("detection_id"), (None, "UNRESOLVED", "NO_ROW_IMAGE_EVIDENCE"))
                eligible_distances = _eligible_edge_distances(point, bottom_edges)
                distance = point.distance(bottom_edges[proposed]) if proposed is not None else eligible_distances[0][0] if eligible_distances else None
            elif bottom_edges is not None:
                proposed, source, distance, reason = _supported_bottom_edge_assignment(point, bottom_edges, roi, rows,
                    (row_mask_support or {}).get(item.get("detection_id"), set()))
            else:
                proposed, source, distance = _anchor_row(point, rows, roi)
            state = item.get("row_assignment_v2", {}).get("state")
            if proposed is not None:
                within = _owned_row_band(point, rows[proposed], bottom_edges[proposed], roi,
                    item.get("reference_size", {}).get("width_m", WIDTH_M)) if bottom_edges is not None else shape.intersection(rows[proposed])
                if within.is_valid and within.area > 1e-10:
                    owner = proposed
                    if source not in {"MASK_SUPPORTED_NEAREST_EDGE", "IMAGE_POINT", "IMAGE_MASK", "IMAGE_NEAREST_EDGE"}:
                        reason = "ASSIGNED"
                    uncertain = source in {"NEAREST_APPROXIMATE", "BOTTOM_EDGE_APPROXIMATE", "MASK_SUPPORTED_NEAREST_EDGE", "IMAGE_POINT", "IMAGE_MASK", "IMAGE_NEAREST_EDGE"} or state not in {"POINT_ASSIGNED", "FOOTPRINT_ASSIGNED"}
                else:
                    source = "UNRESOLVED"
                    reason = "NO_ROW_AREA"
        except (KeyError, TypeError, ValueError):
            valid = False
            reason = "INVALID_REFERENCE"
        owners.append(owner)
        effective = within if owner is not None else shape
        evidence.append((item, effective, (owner, "AMBIGUOUS" if uncertain else "POINT_ASSIGNED", [])))
        scoped.append({**item, "canonical_footprint": _geometry(effective), "reference_uncertain": uncertain,
            "row_assignment_source": source, "row_assignment_distance_m": distance, "row_assignment_reason": reason})
    uncertainty = calculate_uncertainty(list(rows.items()), evidence)
    # Unknown causes and prior invalid inputs must not be cleared by row scoping.
    previous = {item["row_id"]: item for item in analysis["uncertainty"]["rows"]}
    assignment_reasons = {"AMBIGUOUS_ROW_ASSIGNMENT", "UNASSIGNED_ROW_INTERSECTION"}
    for row in uncertainty["rows"]:
        old = previous.get(row["row_id"], {})
        causes = old.get("reasons", [])
        if old.get("validation") is False or (old.get("status") == "UNCERTAIN" and (not causes or not set(causes) <= assignment_reasons)):
            row.update(status="UNCERTAIN", validation=old.get("validation", True),
                reasons=sorted(set(causes + row["reasons"])),
                affected_detection_ids=sorted(set(old.get("affected_detection_ids", []) + row["affected_detection_ids"])))
    uncertainty["validation"] = valid
    return {**analysis, "detections": scoped, "uncertainty": uncertainty}, owners


def evaluate_gap_geometry(analysis, inverse, image_occluders, *, evidence_count, calibration_source="UNKNOWN", width_only=False, primary_count=None, virtual_slots=False, slot_width_m=VIRTUAL_SLOT_WIDTH_M, continuous_gaps=False, clearance_margin_m=0., localize_row_uncertainty=False, near_fit_advisories=False, image_occluder_details=None, visible_free_shapes=False, row_owned_references=False, row_bottom_edges=None, row_mask_support=None, image_row_assignments=None):
    if not math.isfinite(slot_width_m) or not 0 < slot_width_m <= 5:
        raise ValueError("Target width must be positive and at most 5 metres")
    if not math.isfinite(clearance_margin_m) or not 0 <= clearance_margin_m <= 1:
        raise ValueError("Total lateral margin must be between 0 and 1 metre")
    if continuous_gaps and virtual_slots:
        raise ValueError("Choose continuous gaps or virtual slots")
    if row_owned_references and not (continuous_gaps or virtual_slots or width_only or visible_free_shapes):
        raise ValueError("Row-owned references require local width diagnostics")
    result = SegmentationGapResult(calibration_source=calibration_source, evaluation_mode="WIDTH_ONLY" if width_only else "FULL_FOOTPRINT")
    if width_only:
        result.width_measurement, result.measurement_band_m = "ROW_MIDLINE_BAND", .02
    if virtual_slots:
        result.evaluation_mode, result.target_width_m, result.target_length_m = "VIRTUAL_SLOTS", slot_width_m, None
        result.width_measurement, result.measurement_band_m = "FULL_DEPTH", None
    if continuous_gaps:
        result.evaluation_mode, result.target_width_m, result.target_length_m = "CONTINUOUS_GAPS", slot_width_m, None
        result.width_measurement, result.measurement_band_m = "FULL_DEPTH", None
        result.clearance_margin_m = clearance_margin_m
    if visible_free_shapes:
        result.evaluation_mode, result.target_width_m, result.target_length_m = "VISIBLE_FREE_SHAPES", slot_width_m, None
        result.width_measurement, result.measurement_band_m = "VISIBLE_PATCH_CROSS_SECTION", None
        result.clearance_margin_m = clearance_margin_m
    if evidence_count == 0:
        result.status, result.reasons = "UNKNOWN", ["NO_SEGMENTATION_EVIDENCE_IN_ROI"]
    roi = _geometry_to_shapely(analysis["physical_map"]["parking_roi"])
    row_shapes = {item["row_id"]: Polygon([(p["x_m"], p["y_m"]) for p in item["polygon"]]) for item in analysis["physical_map"]["rows"]}
    originals = [_geometry_to_shapely(item["canonical_footprint"]) for item in analysis["detections"]]
    owners = [None] * len(originals)
    original_detections = analysis["detections"]
    if row_owned_references:
        analysis, owners = _scope_row_references(analysis, row_shapes, roi, originals, row_bottom_edges, row_mask_support, image_row_assignments)
        result.uncertain_reference_ids = [item["detection_id"] for item in analysis["detections"] if item["reference_uncertain"]]
    result.row_owned_references = row_owned_references
    occupied = unary_union([_geometry_to_shapely(item["canonical_footprint"]) for item in analysis["detections"]])
    occupied_by_row = {key: unary_union([_geometry_to_shapely(item["canonical_footprint"])
        for index, item in enumerate(analysis["detections"]) if owners[index] is None or owners[index] == key]) for key in row_shapes}
    result.parking_roi_metric = GapMetricGeometry.model_validate(_geometry(roi))
    result.occupied_metric = GapMetricGeometry.model_validate({"polygons": [polygon for item in analysis["detections"] for polygon in item["canonical_footprint"]["polygons"]]})
    for index, item in enumerate(analysis["detections"]):
        shape = _geometry_to_shapely(item["canonical_footprint"])
        clipped = shape.intersection(roi)
        # Boundary-only intersections are not occupied area.
        clipped = unary_union(_parts(clipped))
        source = "PRIMARY" if primary_count is None or index < primary_count else "SEGMENTATION"
        result.occupied_layers.append(GapOccupancyLayer(detection_id=item.get("detection_id", f"{source.lower()}-{index}"), detection_index=item.get("detection_index", index), assigned_row_id=owners[index], source=source,
            row_assignment_source=item.get("row_assignment_source", "UNRESOLVED"), row_assignment_distance_m=item.get("row_assignment_distance_m"),
            row_assignment_reason=item.get("row_assignment_reason", "UNRESOLVED"),
            geometry=GapMetricGeometry.model_validate(_geometry(originals[index])), roi_geometry=GapMetricGeometry.model_validate(_geometry(clipped)),
            row_depth_geometry=_row_depth_display(shape, {owners[index]: row_shapes[owners[index]]} if owners[index] is not None else row_shapes, roi)))
    occluders = unary_union(image_occluders)
    uncertainty = {item["row_id"]: item["status"] for item in analysis["uncertainty"]["rows"]}
    uncertainty_details = {item["row_id"]: item for item in analysis["uncertainty"]["rows"]}
    uncertainty_source = {**analysis, "detections": original_detections}
    regions, localized_rows = _assignment_uncertainty(uncertainty_source) if localize_row_uncertainty else ({}, set())
    result.uncertainty_regions = [GapUncertaintyRegion(detection_id=key, reasons=causes, geometry=GapMetricGeometry.model_validate(_geometry(envelope))) for key, (envelope, causes) in sorted(regions.items())]
    if visible_free_shapes:
        return _evaluate_visible_rows(result, analysis, inverse, roi, occupied, occluders, row_shapes, uncertainty, uncertainty_details, regions, localized_rows, evidence_count, image_occluder_details, near_fit_advisories, occupied_by_row)
    for source in analysis["capacity"]["rows"]:
        row_id = source["row_id"]
        occupied = occupied_by_row[row_id]
        width_corridors = []
        if evidence_count > 0:
            measured = _measure_row(row_id, row_shapes[row_id], row_shapes[row_id] if virtual_slots or continuous_gaps else roi, occupied, inverse, width_only=width_only or virtual_slots or continuous_gaps, placements=width_corridors if width_only or virtual_slots or continuous_gaps else None, full_row_depth=virtual_slots or continuous_gaps, required_width_m=slot_width_m+clearance_margin_m if virtual_slots or continuous_gaps else WIDTH_M)
            remaining = MAX_CANDIDATES - len(result.measured_gaps)
            result.measured_gaps.extend(measured[:remaining])
            result.truncated |= len(measured) > remaining
        # One candidate per uninterrupted free corridor. Any uncertainty stays
        # attached to the whole interval rather than creating artificial slots.
        footprints = width_corridors if width_only or continuous_gaps else [_geometry_to_shapely(item["footprint_metric"]) for item in source["placements"]]
        slots = _split_into_slots(width_corridors, row_shapes[row_id], MAX_CANDIDATES-len(result.candidates), slot_width_m) if virtual_slots else []
        if virtual_slots:
            footprints = [item[0] for item in slots]
        for index, footprint in enumerate(footprints):
            if len(result.candidates) >= MAX_CANDIDATES:
                result.truncated = True
                break
            row = row_shapes[row_id]
            reasons = list(result.reasons)
            geometry_valid = (footprint.is_valid and footprint.area > 0 and row.buffer(FITTING_TOLERANCE_M).covers(footprint) and footprint.intersection(occupied).area <= 1e-10) if width_only or virtual_slots or continuous_gaps else (source["validation"]["valid"] and validate_witness(footprint, row, occupied))
            if not geometry_valid or not roi.buffer(FITTING_TOLERANCE_M).covers(footprint):
                reasons.append("FOOTPRINT_NOT_PROVEN")
            if analysis["uncertainty"].get("validation") is not True or (uncertainty.get(row_id) != "CLEAR" and row_id not in localized_rows):
                reasons.append("ROW_UNCERTAIN")
                reasons.extend(uncertainty_details.get(row_id, {}).get("reasons", []))
            affected = [key for key, (envelope, _) in sorted(regions.items()) if footprint.intersection(envelope).area > 1e-10]
            if affected:
                reasons.append("LOCAL_ROW_UNCERTAINTY")
            polygon_image = _project(list(footprint.exterior.coords)[:-1], inverse)
            occlusion_evidence, occlusion_available, occlusion_truncated = [], False, False
            if polygon_image is None:
                reasons.append("PROJECTION_OUTSIDE_VALID_IMAGE")
            else:
                projected = Polygon([(p.x, p.y) for p in polygon_image])
                if not projected.is_valid or projected.area <= 1e-12:
                    reasons.append("INVALID_IMAGE_PROJECTION")
                else:
                    occlusion_available = image_occluder_details is not None
                    if projected.intersection(occluders).area > 1e-10:
                        reasons.append("GROUND_MAY_BE_OCCLUDED")
                        occlusion_available, occlusion_evidence, occlusion_truncated = _overlap_diagnostics(projected, image_occluder_details)
            width, endpoints = _corridor(footprint, row, roi, occupied)
            if virtual_slots or continuous_gaps:
                angle, origin = _row_angle(row), row.centroid
                local_slot = rotate(translate(footprint, -origin.x, -origin.y), -angle, origin=(0, 0))
                left, bottom, right, top = local_slot.bounds
                width = slot_width_m if virtual_slots else right-left
                ends = [rotate(translate(Point(x, (bottom+top)/2), origin.x, origin.y), angle, origin=(origin.x, origin.y)) for x in (left, right)]
                endpoints = [(point.x, point.y) for point in ends]
            width_line = _project(endpoints, inverse) if endpoints else None
            too_narrow = width + FITTING_TOLERANCE_M < (slot_width_m+clearance_margin_m if continuous_gaps else WIDTH_M)
            if (width_only or continuous_gaps) and too_narrow:
                reasons.append("WIDTH_BELOW_TARGET")
            if width_line is None or (too_narrow and not width_only and not continuous_gaps):
                reasons.append("FULL_DEPTH_CORRIDOR_NOT_PROVEN")
            nearest_line = None
            clearance = None
            if not width_only and not virtual_slots and not continuous_gaps and not occupied.is_empty:
                near = nearest_points(footprint, occupied)
                clearance = footprint.distance(occupied)
                nearest_line = _project([(p.x, p.y) for p in near], inverse)
            label = _project([(footprint.centroid.x, footprint.centroid.y)], inverse)
            state = "UNKNOWN" if any(reason != "WIDTH_BELOW_TARGET" for reason in reasons) else "INSUFFICIENT_WIDTH" if too_narrow else "WIDTH_SUFFICIENT" if width_only or continuous_gaps else "FIT"
            if virtual_slots and not reasons:
                state = "SLOT_CLEAR"
            near_fit = None
            if near_fit_advisories and continuous_gaps and state == "INSUFFICIENT_WIDTH":
                near_fit = _near_fit_width(footprint, row, roi, occupied, analysis, regions, slot_width_m+clearance_margin_m, inverse, occluders)
                if near_fit is not None:
                    state = "ALMOST_AVAILABLE"
                    reasons.append("SMALL_OCCUPIED_CONFLICT")
            result.candidates.append(GapCandidate(id=f"{row_id}-{'slot' if virtual_slots else 'gap'}-{index+1}", row_id=row_id, state=state,
                width_blocking_detection_ids=_width_blocking_ids(footprint, row, row_id, analysis, owners, row_owned_references),
                occlusion_evidence=occlusion_evidence, occlusion_evidence_available=occlusion_available, occlusion_evidence_truncated=occlusion_truncated,
                near_fit=near_fit,
                width_check="INSUFFICIENT" if too_narrow else "SUFFICIENT",
                uncertain_detection_ids=affected,
                slot_length_m=slots[index][2] if virtual_slots else top-bottom if continuous_gaps else None, source_gap_width_m=slots[index][1] if virtual_slots else None,
                polygon_metric=_metric_points(list(footprint.exterior.coords)[:-1]), width_line_metric=_metric_points(endpoints), label_metric=MetricGroundPoint(x_m=footprint.centroid.x, y_m=footprint.centroid.y),
                reasons=reasons, gap_width_m=width, nearest_clearance_m=clearance, polygon_image=polygon_image,
                width_line_image=width_line, nearest_line_image=nearest_line, label_image=label[0] if label else None))
        candidates = [item for item in result.candidates if item.row_id == row_id]
        fits = sum(item.state in {"FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR"} for item in candidates)
        unknown = sum(item.state == "UNKNOWN" for item in candidates)
        almost = sum(item.state == "ALMOST_AVAILABLE" for item in candidates)
        state = ("SLOT_CLEAR" if virtual_slots else "WIDTH_SUFFICIENT" if width_only or continuous_gaps else "FIT") if fits else "UNKNOWN" if unknown or result.reasons or uncertainty.get(row_id) != "CLEAR" or result.truncated else "NO_FIT"
        row = row_shapes[row_id]
        if not fits and almost:
            state = "ALMOST_AVAILABLE"
        outline = _project(list(row.exterior.coords)[:-1], inverse)
        label = _project([(row.centroid.x, row.centroid.y)], inverse)
        result.rows.append(GapRow(row_id=row_id, state=state, fit_count=fits, unknown_count=unknown,
            bottom_edge_metric=_metric_points(row_bottom_edges[row_id].coords) if row_bottom_edges is not None else [],
            bottom_edge_image=_project(row_bottom_edges[row_id].coords, inverse) if row_bottom_edges is not None else None,
            almost_count=almost,
            uncertainty_scope="LOCAL_REFERENCE_ENVELOPE" if row_id in localized_rows else "NONE" if uncertainty.get(row_id) == "CLEAR" else "ROW",
            reasons=uncertainty_details.get(row_id, {}).get("reasons", []), affected_detection_ids=uncertainty_details.get(row_id, {}).get("affected_detection_ids", []),
            polygon_metric=_metric_points(list(row.exterior.coords)[:-1]), label_metric=MetricGroundPoint(x_m=row.centroid.x, y_m=row.centroid.y),
            polygon_image=outline, label_image=label[0] if label else None))
        background_reason = "NO_SEGMENTATION_EVIDENCE_IN_ROI" if evidence_count == 0 else "CANDIDATE_LIMIT_REACHED" if result.truncated else "NO_FULL_DEPTH_CANDIDATE" if continuous_gaps else "NO_CANDIDATE_AT_LOCATION"
        result.background_regions.extend(_describe_background(row_id, row, roi, occupied, candidates, result.occupied_layers, background_reason, inverse, image_occluder_details))
    result.green_count = sum(item.state in {"FIT", "WIDTH_SUFFICIENT", "SLOT_CLEAR"} for item in result.candidates)
    result.unknown_count = sum(item.state == "UNKNOWN" for item in result.candidates)
    result.narrow_count = sum(item.state == "INSUFFICIENT_WIDTH" for item in result.candidates)
    result.almost_count = sum(item.state == "ALMOST_AVAILABLE" for item in result.candidates)
    return result


def _restore_source_detection_ids(value, indices):
    """Keep image-mask diagnostics indexed to the original Seg inference."""
    ids = {f"detection_{index+1}": f"detection_{source+1}" for index, source in enumerate(indices)}
    def remap(item):
        if isinstance(item, dict):
            return {ids.get(key, key): indices[child] if key == "detection_index" and isinstance(child, int)
                else remap(child) for key, child in item.items()}
        if isinstance(item, list):
            return [remap(child) for child in item]
        return ids.get(item, item) if isinstance(item, str) else item
    return remap(value)


def _mask_in_selected_rows(mask, image_rows):
    return mask is not None and mask.area > 1e-12 and mask.intersection(image_rows).area / mask.area >= MASK_ROW_MIN_OVERLAP_RATIO


def analyze_segmentation_gaps(standard: DetectionResponse, segmentation: SegmentationExperimentResult, service=parking_analysis_service, *, reference_sizes=None, incoming_width_m=None, clearance_margin_m=0., visible_free_shapes=False, bottom_edge_assignment=False, image_row_assignment=False):
    if incoming_width_m is not None and (not math.isfinite(incoming_width_m) or not 0 < incoming_width_m <= 5):
        raise ValueError("Incoming width must be positive and at most 5 metres")
    if not math.isfinite(clearance_margin_m) or not 0 <= clearance_margin_m <= 1:
        raise ValueError("Total lateral margin must be between 0 and 1 metre")
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
        # Classifier references index primary detections, not segmentation detections.
        # Do not transfer those dimensions by index or include primary obstacles.
        detections = [Detection(class_id=0, class_name="motorcycle", confidence=item.confidence, bbox=item.bbox) for item in segmentation.detections]
        if len(detections) > 600:
            raise ValueError("Too many detections")
        rows = ParkingAnalysisService._measured_rows(response.result.model_dump(), ground.model_dump(), parking.model_dump())
        bottom_edges = _row_bottom_edges(parking, matrix) if bottom_edge_assignment or image_row_assignment else None
        image_roi = Polygon([(point.x, point.y) for point in parking.parking_roi.polygon])
        image_row_shapes = {row.id: Polygon([(point.x, point.y) for point in row.polygon]).intersection(image_roi) for row in parking.rows}
        image_rows = unary_union(list(image_row_shapes.values()))
        occluder_details = _segmentation_occluders(segmentation)
        masks = {index: shape for index, kind, shape in occluder_details if kind == "MASK"}
        row_mask_support = {f"detection_{index+1}": {key for key, row in image_row_shapes.items() if _mask_in_selected_rows(mask, row)}
            for index, mask in masks.items()}
        indices = []
        row_assignments = []
        image_edges = _row_bottom_edges(parking, np.eye(3)) if image_row_assignment else None
        image_assignments = {} if image_row_assignment else None
        for index, item in enumerate(detections):
            anchor = transform_point(item.bbox.x + item.bbox.width/2, item.bbox.y + item.bbox.height, matrix)
            if anchor is None:
                raise ValueError("Invalid ground anchor projection")
            point = Point(anchor)
            if image_row_assignment:
                owner, source, reason = _nearest_image_edge_assignment(item.bbox, image_edges, image_row_shapes, segmentation.image_width, segmentation.image_height, roi.distance(point))
                image_assignments[f"detection_{index+1}"] = (owner, source, reason)
                eligible = _eligible_edge_distances(point, bottom_edges)
                distance = point.distance(bottom_edges[owner]) if owner is not None else eligible[0][0] if eligible else None
                row_assignments.append(GapDetectionRowAssignment(detection_id=f"detection_{index+1}", assigned_row_id=owner,
                    ground_point=MetricGroundPoint(x_m=point.x, y_m=point.y), distance_m=distance, reason=reason,
                    **_row_distance_witness(point, bottom_edges, inverse, owner)))
                anchor_in_row = owner is not None
            elif bottom_edges is not None:
                owner, _, distance, reason = _supported_bottom_edge_assignment(point, bottom_edges, roi, dict(rows), row_mask_support.get(f"detection_{index+1}", set()))
                row_assignments.append(GapDetectionRowAssignment(detection_id=f"detection_{index+1}", assigned_row_id=owner,
                    ground_point=MetricGroundPoint(x_m=point.x, y_m=point.y), distance_m=distance, reason=reason,
                    **_row_distance_witness(point, bottom_edges, inverse)))
                anchor_in_row = owner is not None
            else:
                anchor_in_row = _anchor_row(point, dict(rows), roi)[0] is not None
            mask_in_row = _mask_in_selected_rows(masks.get(index), image_rows)
            if anchor_in_row or (bottom_edges is None and mask_in_row):
                indices.append(index)
        combined = standard.model_copy(update={"detections": [detections[index] for index in indices], "parking_analysis": None})
        sizes = []
        for _ in indices:
            sizes.append(ReferenceDimensions(width_m=WIDTH_M, length_m=LENGTH_M, basis="STANDARD_SEGMENTATION_REFERENCE"))
        analysis = _restore_source_detection_ids(service.analyze(combined, reference_sizes=sizes), indices)
        # Outside-row vehicles remain image occluders, never synthetic ground
        # obstacles whose arbitrary reference length reserves another row.
        occluders = [shape for _, _, shape in occluder_details]
        evidence = sum(item["inside_parking_roi"] for item in analysis["detections"])
        target = incoming_width_m if incoming_width_m is not None else WIDTH_M
        result = evaluate_gap_geometry(analysis, response.result.inverse_matrix, occluders, evidence_count=evidence, calibration_source=ground.provenance, continuous_gaps=True, slot_width_m=target, clearance_margin_m=clearance_margin_m, primary_count=0, localize_row_uncertainty=True, near_fit_advisories=True, image_occluder_details=occluder_details, visible_free_shapes=visible_free_shapes, row_owned_references=not visible_free_shapes, row_bottom_edges=bottom_edges, row_mask_support=row_mask_support, image_row_assignments=image_assignments)
        result.occupancy_source = "SEGMENTATION_ONLY"
        result.occupancy_scope = "IMAGE_NEAREST_LOWER_EDGE" if image_row_assignment else "BOTTOM_EDGE_ANCHOR" if bottom_edges is not None else "GROUND_ANCHOR_OR_ROW_MASK"
        layers_by_id = {layer.detection_id: layer for layer in result.occupied_layers}
        for assignment in row_assignments:
            layer = layers_by_id.get(assignment.detection_id)
            if layer is not None:
                assignment.assigned_row_id = layer.assigned_row_id
                assignment.reason = layer.row_assignment_reason
        result.detection_row_assignments = row_assignments
        result.horizontal_vehicles = horizontal_vehicle_clearances(segmentation, matrix, inverse, roi)
        result.excluded_detection_ids = [f"detection_{index+1}" for index in range(len(detections)) if index not in indices]
        result.orientation_hypotheses = [build_bbox_orientation_hypothesis(segmentation.detections[source].bbox, segmentation.image_width, segmentation.image_height,
            analysis["detections"][index]["canonical_footprint"], response.result.inverse_matrix,
            result.occupied_layers[index].detection_id, source) for index, source in enumerate(indices)
            if result.occupied_layers[index].roi_geometry.polygons]
        if incoming_width_m is not None:
            result.incoming_vehicle = IncomingVehicleRecommendation(width_m=incoming_width_m, allocation_width_m=incoming_width_m+clearance_margin_m,
                almost_count=result.almost_count,
                reasons=result.reasons,
                recommended_count=result.green_count, unknown_count=result.unknown_count, truncated=result.truncated,
                candidates=[item.model_copy(update={"id": f"incoming-{item.id}"}) for item in result.candidates])
        try:
            recommend_families_by_width(result, load_rules())
        except (OSError, ValueError):
            result.family_recommendation_error = "Reference-size rules unavailable; check config/motorcycle_reference_sizes.json."
        if calibration_version(directory) != version:
            raise ValueError("Calibration changed during analysis")
        result.calibration_version = version
        return result
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, np.linalg.LinAlgError, GEOSException):
        return SegmentationGapResult(status="CALIBRATION_REQUIRED", occupancy_source="SEGMENTATION_ONLY", evaluation_mode="VISIBLE_FREE_SHAPES" if visible_free_shapes else "CONTINUOUS_GAPS", width_measurement="VISIBLE_PATCH_CROSS_SECTION" if visible_free_shapes else "FULL_DEPTH", target_width_m=incoming_width_m if incoming_width_m is not None else WIDTH_M, clearance_margin_m=clearance_margin_m, target_length_m=None, reasons=["CURRENT_MATCHING_CALIBRATION_REQUIRED"])
