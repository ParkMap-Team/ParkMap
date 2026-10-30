from datetime import datetime
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

def _row_number(row_id: str) -> int:
    match = re.fullmatch(r"row_([1-9][0-9]*)", row_id)
    if match is None:
        raise ValueError("Row IDs must use the row_N format with N >= 1.")
    return int(match.group(1))


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class DetectionBBox(BaseModel):
    """Normalized top-left box: x=left, y=top; never center coordinates."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)


class Detection(BaseModel):
    class_id: int = Field(ge=0)
    class_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: DetectionBBox


class DetectionAnalysisModel(BaseModel):
    name: str
    status: Literal["ready"] = "ready"


class DetectionInference(BaseModel):
    imgsz: int = Field(gt=0)
    confidence_threshold: float = Field(ge=0.0, le=1.0)
    nms_iou: float = Field(ge=0.0, le=1.0)
    processing_time_ms: float = Field(ge=0.0)


class DetectionResponse(BaseModel):
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    model: DetectionAnalysisModel
    inference: DetectionInference
    detections: list[Detection]
    parking_analysis: dict[str, Any] | None = None


class CalibrationPoint(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class CalibrationPolygon(BaseModel):
    polygon: list[CalibrationPoint] = Field(min_length=3)


class CalibrationRow(CalibrationPolygon):
    id: str = Field(pattern=r"^row_[1-9][0-9]*$")
    name: str = Field(min_length=1)


class CalibrationReferenceImage(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ParkingCalibration(BaseModel):
    schema_version: Literal[2] = 2
    camera_id: str = Field(min_length=1)
    reference_image: CalibrationReferenceImage
    parking_roi: CalibrationPolygon
    rows: list[CalibrationRow] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_rows(self) -> "ParkingCalibration":
        ids = [row.id for row in self.rows]
        if len(ids) != len(set(ids)):
            raise ValueError("Calibration row IDs must be unique.")
        self.rows.sort(key=lambda row: _row_number(row.id))
        return self


MetricMeasurementSource = Literal["ESTIMATED", "MEASURED"]
MetricRowId = str


class MetricGroundPoint(BaseModel):
    x_m: float = Field(allow_inf_nan=False)
    y_m: float = Field(allow_inf_nan=False)


GroundMeasurementSource = Literal["ESTIMATED", "MEASURED"]


# Estimate details describe an input without changing computed geometry, so geometry fingerprints skip them.
ESTIMATE_DETAIL_FIELDS = {"uncertainty_m", "estimation_basis"}


class GroundProvenance(BaseModel):
    """Where a geometry input came from. An ESTIMATED input states its numeric uncertainty and basis."""

    provenance: GroundMeasurementSource
    uncertainty_m: float | None = Field(default=None, gt=0.0, allow_inf_nan=False)
    estimation_basis: str | None = Field(default=None, min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_estimate(self) -> "GroundProvenance":
        if self.provenance == "ESTIMATED" and (self.uncertainty_m is None or self.estimation_basis is None):
            raise ValueError("ESTIMATED inputs need uncertainty_m and estimation_basis.")
        if self.provenance == "MEASURED" and self.estimation_basis is not None:
            raise ValueError("MEASURED inputs must not carry an estimation_basis.")
        return self


class GroundCoordinate(BaseModel):
    x_m: float = Field(allow_inf_nan=False)
    y_m: float = Field(allow_inf_nan=False)


class GroundControlPoint(GroundProvenance):
    id: str = Field(min_length=1)
    image_x: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    image_y: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    ground_x_m: float = Field(allow_inf_nan=False)
    ground_y_m: float = Field(allow_inf_nan=False)


class GroundReferenceDistance(BaseModel):
    id: str = Field(min_length=1)
    point_a: str = Field(min_length=1)
    point_b: str = Field(min_length=1)
    distance_m: float = Field(gt=0.0, allow_inf_nan=False)
    provenance: GroundMeasurementSource


class GroundMeasuredRow(GroundProvenance):
    length_m: float | None = Field(default=None, gt=0.0, allow_inf_nan=False)
    width_m: float | None = Field(default=None, gt=0.0, allow_inf_nan=False)


class GroundPlaneCalibration(BaseModel):
    schema_version: Literal[1] = 1
    camera_id: str = Field(min_length=1)
    reference_image: CalibrationReferenceImage
    coordinate_system: dict[str, str]
    control_points: list[GroundControlPoint] = Field(default_factory=list)
    reference_distances: list[GroundReferenceDistance] = Field(default_factory=list)
    measured_rows: dict[MetricRowId, GroundMeasuredRow] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_ground_plane_ids(self) -> "GroundPlaneCalibration":
        for row_id in self.measured_rows:
            _row_number(row_id)
        for items, label in ((self.control_points, "control point"), (self.reference_distances, "reference distance")):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"Duplicate {label} IDs are not allowed.")
        point_ids = {point.id for point in self.control_points}
        image_points = {(point.image_x, point.image_y) for point in self.control_points}
        ground_points = {(point.ground_x_m, point.ground_y_m) for point in self.control_points}
        if len(image_points) != len(self.control_points):
            raise ValueError("Ground control point image coordinates must be unique.")
        if len(ground_points) != len(self.control_points):
            raise ValueError("Ground control point ground coordinates must be unique.")
        for segment in self.reference_distances:
            if segment.point_a == segment.point_b or segment.point_a not in point_ids or segment.point_b not in point_ids:
                raise ValueError("Reference distances must connect two existing, distinct control points.")
        return self

    @property
    def provenance(self) -> GroundMeasurementSource:
        """The calibration is ESTIMATED as a whole when any geometry input was estimated."""
        inputs = [*self.control_points, *self.measured_rows.values()]
        return "ESTIMATED" if any(item.provenance == "ESTIMATED" for item in inputs) else "MEASURED"


class GroundPlaneCalibrationResponse(BaseModel):
    status: Literal["NOT_READY", "READY_FOR_HOMOGRAPHY"]
    control_point_count: int
    measured_point_count: int
    minimum_required: Literal[4] = 4
    provenance: GroundMeasurementSource
    calibration: GroundPlaneCalibration


GroundPlaneHomographyStatus = Literal["INPUT_NOT_READY", "CALCULATED", "VALIDATED", "VALIDATION_WARNING", "INVALID", "STALE"]


class GroundPlanePointDiagnostic(BaseModel):
    id: str
    measured_x_m: float = Field(allow_inf_nan=False)
    measured_y_m: float = Field(allow_inf_nan=False)
    projected_x_m: float = Field(allow_inf_nan=False)
    projected_y_m: float = Field(allow_inf_nan=False)
    error_x_m: float = Field(allow_inf_nan=False)
    error_y_m: float = Field(allow_inf_nan=False)
    error_m: float = Field(ge=0.0, allow_inf_nan=False)
    inlier: bool


class GroundPlaneMetricPoint(BaseModel):
    x_m: float = Field(allow_inf_nan=False)
    y_m: float = Field(allow_inf_nan=False)


class GroundPlaneMetricPolygon(BaseModel):
    id: str
    points: list[GroundPlaneMetricPoint]
    longitudinal_extent_m: float = Field(ge=0.0, allow_inf_nan=False)
    cross_extent_m: float = Field(ge=0.0, allow_inf_nan=False)
    measured_length_m: float | None = None
    measured_width_m: float | None = None
    length_difference_m: float | None = None
    width_difference_m: float | None = None


class GroundPlaneHomographyResult(BaseModel):
    schema_version: Literal[1] = 1
    camera_id: str
    source_calibration_fingerprint: str
    row_measurements_fingerprint: str
    matrix: list[list[float]]
    inverse_matrix: list[list[float]]
    control_point_count: int
    inlier_count: int
    rmse_m: float
    mean_error_m: float
    median_error_m: float
    max_error_m: float
    warning_rmse_m: float
    warning_max_error_m: float
    status: GroundPlaneHomographyStatus
    calculated_at: datetime
    method: Literal["NORMALIZED_DLT_SVD"] = "NORMALIZED_DLT_SVD"
    ransac_used: Literal[False] = False
    point_diagnostics: list[GroundPlanePointDiagnostic]
    roi_metric: GroundPlaneMetricPolygon | None = None
    rows_metric: list[GroundPlaneMetricPolygon] = Field(default_factory=list)


class GroundPlaneHomographyResponse(BaseModel):
    status: GroundPlaneHomographyStatus
    current: bool
    row_validation_current: bool
    message: str
    result: GroundPlaneHomographyResult | None = None


class PhysicalRowEndpoint(BaseModel):
    clicked_image: CalibrationPoint
    effective_image: CalibrationPoint
    snapped_to_roi_boundary: bool = False


class PhysicalRowEndpointPair(BaseModel):
    override_enabled: bool = False
    start: PhysicalRowEndpoint | None = None
    end: PhysicalRowEndpoint | None = None


class PhysicalRowGeometryConfig(BaseModel):
    schema_version: Literal[1] = 1
    camera_id: str = Field(min_length=1)
    measurement_source_fingerprint: str
    rows: dict[MetricRowId, PhysicalRowEndpointPair] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_row_ids(self) -> "PhysicalRowGeometryConfig":
        for row_id in self.rows:
            _row_number(row_id)
        return self


class MotorcycleFittingConfiguration(BaseModel):
    schema_version: Literal[1] = 1
    measurement_source: MetricMeasurementSource = "ESTIMATED"
    required_space_m: float = Field(gt=0.0, allow_inf_nan=False)


class MotorcycleFittingResponse(BaseModel):
    configured: bool
    configuration: MotorcycleFittingConfiguration | None


# Live parking state contract (worker -> API -> LIFF). Geometry uses the
# parking area's metric ground frame; a polygon is a list of rings where ring
# zero is the exterior and later rings are holes.
IDENTIFIER_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}$"
MetricRing = list[MetricGroundPoint]
MetricPolygon = list[MetricRing]
LiveRegionKind = Literal["AVAILABLE", "ALMOST_AVAILABLE", "UNKNOWN"]
StateSourceKind = Literal["LIVE_CAMERA", "RECORDED_REPLAY", "STILL_IMAGE_LOOP", "SYNTHETIC_FIXTURE"]
# DEMO is a fresh STILL_IMAGE_LOOP state: current processing of recorded photos, never the lot right now.
AreaLiveStatus = Literal["LIVE", "DEMO", "STALE", "NO_DATA", "NOT_CALIBRATED", "CALIBRATION_MISMATCH"]


def _validate_polygon(polygon: MetricPolygon) -> MetricPolygon:
    if not polygon or any(len(ring) < 3 for ring in polygon):
        raise ValueError("Polygons need an exterior ring and every ring needs at least three points.")
    return polygon


class LiveRegion(BaseModel):
    kind: LiveRegionKind
    row_id: str | None = None
    polygon: MetricPolygon

    @model_validator(mode="after")
    def validate_polygon(self) -> "LiveRegion":
        _validate_polygon(self.polygon)
        return self


class MotorcycleProxy(BaseModel):
    detection_id: str = Field(min_length=1)
    center: MetricGroundPoint
    heading_rad: float = Field(allow_inf_nan=False)
    length_m: float = Field(gt=0.0, allow_inf_nan=False)
    width_m: float = Field(gt=0.0, allow_inf_nan=False)
    confidence: float = Field(ge=0.0, le=1.0)


class ParkingStatePublish(BaseModel):
    """One analysed frame. `observed_at` is when the image was captured; `processed_at` is when it was analysed."""

    schema_version: Literal[2] = 2
    parking_area_id: str = Field(pattern=IDENTIFIER_PATTERN)
    camera_id: str = Field(min_length=1, max_length=128)
    source: StateSourceKind
    observed_at: datetime
    processed_at: datetime
    calibration_version: str = Field(min_length=1, max_length=128)
    calibration_provenance: GroundMeasurementSource
    analysis_version: str = Field(min_length=1, max_length=64)
    regions: list[LiveRegion] = Field(max_length=1000)
    motorcycles: list[MotorcycleProxy] = Field(max_length=1000)

    @model_validator(mode="after")
    def validate_state(self) -> "ParkingStatePublish":
        if self.observed_at.tzinfo is None or self.processed_at.tzinfo is None:
            raise ValueError("observed_at and processed_at must include a timezone.")
        if self.processed_at < self.observed_at:
            raise ValueError("processed_at must not be earlier than observed_at.")
        if self.source == "LIVE_CAMERA" and self.calibration_provenance == "ESTIMATED" and any(region.kind != "UNKNOWN" for region in self.regions):
            raise ValueError("A LIVE_CAMERA state on an ESTIMATED calibration may only publish UNKNOWN regions.")
        return self


class ParkingAreaLiveState(BaseModel):
    parking_area_id: str
    status: AreaLiveStatus
    source: StateSourceKind | None = None
    observed_at: datetime | None = None
    processed_at: datetime | None = None
    age_s: float | None = None
    regions: list[LiveRegion] = Field(default_factory=list)
    motorcycles: list[MotorcycleProxy] = Field(default_factory=list)


class SiteParkingStateResponse(BaseModel):
    site_id: str
    generated_at: datetime
    freshness_limit_s: float
    areas: list[ParkingAreaLiveState]


class SiteSummary(BaseModel):
    site_id: str
    name: str
    latitude: float = Field(ge=-90.0, le=90.0, allow_inf_nan=False)
    longitude: float = Field(ge=-180.0, le=180.0, allow_inf_nan=False)


class LotModelParkingArea(BaseModel):
    parking_area_id: str = Field(pattern=IDENTIFIER_PATTERN)
    polygon: MetricPolygon

    @model_validator(mode="after")
    def validate_polygon(self) -> "LotModelParkingArea":
        _validate_polygon(self.polygon)
        return self


LandmarkKind = Literal[
    "ENTRANCE",
    "EXIT",
    "ENTRANCE_EXIT",
    "GUARD_BOOTH",
    "BUILDING",
    "AISLE",
    "BARRIER",
    "TREE",
    "ROAD",
    "WALKWAY",
    "PLANTING",
    "SHELTER",
]
# Kinds that are ground areas, so they need a footprint.
_FOOTPRINT_LANDMARKS = ("AISLE", "ROAD", "WALKWAY", "PLANTING", "SHELTER")
# Kinds that may stand above the ground; a shelter's height is its roof.
_RAISED_LANDMARKS = ("GUARD_BOOTH", "BUILDING", "BARRIER", "PLANTING", "SHELTER")
# How a raised building's walls look: white with a window band on every storey, or brick piers
# between glass. Without one, the walls are plain with windows.
BuildingFacade = Literal["WINDOW_BANDS", "BRICK_AND_GLASS"]


class LotLandmark(BaseModel):
    """A static feature that helps students match the map to the real place.

    `position` anchors the marker and label. A footprint `polygon` or a `line` (a hedge, curb,
    or fence) is optional, except that ground areas (aisle, road, walkway, planting, shelter)
    need their polygon. `height_m` raises a footprint into a block, and a shelter needs it for its
    roof. A tree is a trunk and a round canopy at `position`, so it needs `height_m` and
    `radius_m` and has no footprint. `direction_rad` is the confirmed direction of travel through
    an entrance or exit, counter-clockwise from +x; leave it out when the direction is not
    confirmed. `facade` describes a raised building's walls. `measurement_source` says whether the geometry was measured on site or estimated
    from photos or imagery. Landmarks carry no availability.
    """

    landmark_id: str = Field(pattern=IDENTIFIER_PATTERN)
    kind: LandmarkKind
    name: str | None = Field(default=None, min_length=1, max_length=40)
    position: MetricGroundPoint
    polygon: MetricPolygon | None = None
    line: MetricRing | None = Field(default=None, min_length=2)
    direction_rad: float | None = Field(default=None, allow_inf_nan=False)
    height_m: float | None = Field(default=None, gt=0.0, le=300.0, allow_inf_nan=False)
    radius_m: float | None = Field(default=None, gt=0.0, le=30.0, allow_inf_nan=False)
    facade: BuildingFacade | None = None
    measurement_source: MetricMeasurementSource = "ESTIMATED"

    @model_validator(mode="after")
    def validate_geometry(self) -> "LotLandmark":
        if self.polygon is not None:
            _validate_polygon(self.polygon)
            if self.line is not None:
                raise ValueError("A landmark has a polygon or a line, not both.")
        if self.kind in _FOOTPRINT_LANDMARKS and self.polygon is None:
            raise ValueError(f"{self.kind.capitalize()} landmarks need their polygon.")
        if self.direction_rad is not None and self.kind not in ("ENTRANCE", "EXIT"):
            raise ValueError("Only an entrance or an exit has a direction of travel.")
        if self.kind == "TREE":
            if self.height_m is None or self.radius_m is None:
                raise ValueError("A tree landmark needs its height and canopy radius.")
            if self.polygon is not None or self.line is not None:
                raise ValueError("A tree landmark has no polygon or line.")
            if self.radius_m > self.height_m:
                raise ValueError("A tree canopy radius cannot exceed the tree height.")
            return self
        if self.radius_m is not None:
            raise ValueError("Only a tree landmark has a canopy radius.")
        if self.height_m is not None and (self.kind not in _RAISED_LANDMARKS or self.polygon is None):
            raise ValueError("Only a footprint of a booth, building, barrier, planting, or shelter has a height.")
        if self.kind == "SHELTER" and self.height_m is None:
            raise ValueError("A shelter landmark needs its roof height.")
        if self.facade is not None and (self.kind != "BUILDING" or self.height_m is None):
            raise ValueError("Only a raised building has a facade.")
        return self


class LotModelDefinition(BaseModel):
    """Static lot geometry stored per site version, measured or estimated from photos and imagery."""

    schema_version: Literal[1] = 1
    outline: MetricPolygon
    parking_areas: list[LotModelParkingArea] = Field(min_length=1)
    landmarks: list[LotLandmark] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_polygons(self) -> "LotModelDefinition":
        _validate_polygon(self.outline)
        ids = [area.parking_area_id for area in self.parking_areas]
        if len(ids) != len(set(ids)):
            raise ValueError("Lot model parking areas must be unique.")
        landmark_ids = [landmark.landmark_id for landmark in self.landmarks]
        if len(landmark_ids) != len(set(landmark_ids)):
            raise ValueError("Lot model landmarks must be unique.")
        return self


class LotModelResponse(LotModelDefinition):
    site_id: str
    version: int = Field(ge=1)
    unmonitored: list[MetricPolygon]


class LotModelDraftWrite(BaseModel):
    definition: LotModelDefinition
    expected_revision: int = Field(ge=0)
    base_version: int = Field(ge=0)


class LotModelDraftActivate(BaseModel):
    expected_revision: int = Field(ge=1)
    base_version: int = Field(ge=0)


class LotModelDraftState(BaseModel):
    site_id: str
    revision: int = Field(ge=0)
    base_version: int = Field(ge=0)
    active_version: int = Field(ge=0)
    is_published: bool
    definition: LotModelDefinition
