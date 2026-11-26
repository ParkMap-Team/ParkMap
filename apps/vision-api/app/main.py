import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path as FilePath

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Path,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import Field
from shapely.geometry import Polygon
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.annotations import router as annotations_router
from app.classifier import router as classifier_router
from app.db import repository
from app.db.session import get_session
from app.db.tables import ParkingArea, Site
from app.lot_model_editor import router as lot_model_editor_router
from app.mobile_camera import operator_router as mobile_operator_router
from app.mobile_camera import public_router as mobile_public_router
from app.operator_auth import require_editor_token
from app.models import (
    IDENTIFIER_PATTERN,
    AreaFrameLink,
    DetectionResponse,
    GroundPlaneCalibration,
    GroundPlaneCalibrationResponse,
    GroundPlaneHomographyResponse,
    HealthResponse,
    LotModelDefinition,
    LotModelResponse,
    MotorcycleFittingConfiguration,
    MotorcycleFittingResponse,
    MetricGroundPoint,
    ParkingAreaLiveState,
    ParkingCalibration,
    ParkingStatePublish,
    PhysicalRowGeometryConfig,
    SiteParkingStateResponse,
    SiteSummary,
)
from app.services.calibration_service import calibration_service
from app.services.cv_service import ModelUnavailableError, cv_service
from app.services.ground_plane_calibration_service import (
    ground_plane_calibration_service,
)
from app.services.ground_plane_homography_service import (
    HomographyInputError,
    ground_plane_homography_service,
)
from app.services.guard_booth_clip import (
    CLASSIFICATION_RETRY_S,
    GuardBoothClassification,
    GuardBoothClip,
    GuardBoothClipClassifier,
    configured_clip,
    summarize,
)
from app.services.live_state_service import (
    MAX_FUTURE_SKEW_S,
    evaluate_area_state,
    unmonitored_polygons,
)
from app.services.lot_placement_service import (
    place_area_state,
    placement_for_calibration,
)
from app.services.mobile_camera_sessions import MobileSessionError, mobile_sessions
from app.services.motorcycle_fitting_service import motorcycle_fitting_service
from app.services.motorcycle_reference_sizes import load_rules
from app.services.parking_analysis_service import (
    ParkingCalibrationUnavailableError,
    parking_analysis_service,
)
from app.services.parking_holds import (
    HoldContext,
    mask_held_space,
    owner_recommendation,
    rider_free_ground,
)
from app.services.parking_holds import reserve as reserve_parking_hold
from app.services.parking_holds import snapshot as parking_holds_snapshot
from app.services.physical_row_geometry_service import (
    measurement_fingerprint,
    physical_row_geometry_service,
)
from app.services.recommendation_models import (
    GuardBoothFit,
    GuardBoothFitHold,
    GuardBoothFitRequest,
    PreviewFamily,
    RowRoutePreview,
)
from app.services.rider_recommendation import default_routes, preview_routes
from app.services.region_clipping_service import polygon_shape
from app.services.route_configuration import (
    RouteConfiguration, RouteConflict, RouteEditorState, RouteSettingsUnavailable, RouteWrite, route_settings,
)
from app.services.video_classifier import router as video_classifier_router

SessionDependency = Depends(get_session)
ImageFile = File(..., alias="image")

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Tracking the entrance clip takes minutes on a server CPU; start it before the first visitor asks.
    if os.getenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW") == "1" and (clip := configured_clip()) is not None:
        _guard_booth_classifier.evidence(clip)
    yield


app = FastAPI(title="ParkMap API", version="0.2.0", description="API boundary for ParkMap monitoring and the future CV pipeline.", lifespan=lifespan)
app.include_router(lot_model_editor_router)
app.include_router(annotations_router)
app.include_router(classifier_router)
app.include_router(video_classifier_router)
app.include_router(mobile_operator_router)
app.include_router(mobile_public_router)


@app.exception_handler(MobileSessionError)
async def mobile_session_error(_request, error):
    return JSONResponse({"detail": str(error)}, status_code=error.status)


allowed_origins = [origin.strip() for origin in os.getenv("PARKMAP_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD_BYTES = int(float(os.getenv("PARKMAP_MAX_UPLOAD_MB", "25")) * 1024 * 1024)
MAX_IMAGE_PIXELS = int(os.getenv("PARKMAP_MAX_IMAGE_PIXELS", "40000000"))
IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


SiteId = Path(pattern=IDENTIFIER_PATTERN)
AreaId = Path(pattern=IDENTIFIER_PATTERN)
# A worker sends a downscaled JPEG (app.worker.publisher); these bound what the API stores per area.
MAX_FRAME_BYTES = 3 * 1024 * 1024
MAX_FRAME_EDGE_PX = 4096
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def freshness_limit_s() -> float:
    return float(os.getenv("PARKMAP_STATE_FRESHNESS_S", "15"))


def require_worker_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("PARKMAP_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Worker ingestion is not configured.")
    if authorization is None or not hmac.compare_digest(authorization.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid worker token.")


def _require_site_areas(session: Session, site_id: str) -> list[ParkingArea]:
    if session.get(Site, site_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")
    return repository.site_areas(session, site_id)


@app.get("/api/sites", response_model=list[SiteSummary])
def list_sites(session: Session = SessionDependency) -> list[SiteSummary]:
    return [SiteSummary(site_id=site.id, name=site.name, latitude=site.latitude, longitude=site.longitude) for site in repository.list_sites(session)]


@app.get("/api/sites/{site_id}/lot-model", response_model=LotModelResponse)
def get_lot_model(site_id: str = SiteId, session: Session = SessionDependency) -> LotModelResponse:
    _require_site_areas(session, site_id)
    lot_model = repository.active_lot_model(session, site_id)
    if lot_model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lot model is configured for this site.")
    definition = LotModelDefinition.model_validate(lot_model.payload)
    return LotModelResponse(**definition.model_dump(), site_id=site_id, version=lot_model.version, unmonitored=unmonitored_polygons(definition))


@app.get("/api/sites/{site_id}/parking-state", response_model=SiteParkingStateResponse)
def get_site_parking_state(site_id: str = SiteId, family: PreviewFamily | None = None, session: Session = SessionDependency) -> SiteParkingStateResponse:
    """`family` asks for a rider's map: where the guide recommends, free ground only where that model fits (ADR 0024)."""
    state = _site_parking_state(site_id, session)
    areas = [mask_held_space(session, site_id, area) for area in state.areas]
    if family is not None and _guard_booth_preview_enabled(site_id):
        _, area_model, _, placement = _preview_geometry(site_id, session)
        if area_model is not None and placement is not None:
            areas = [rider_free_ground(area, family, placement.scale) if area.parking_area_id == area_model.parking_area_id else area for area in areas]
    return state.model_copy(update={"areas": areas})


def _site_parking_state(site_id: str, session: Session) -> SiteParkingStateResponse:
    area_ids = [area.id for area in _require_site_areas(session, site_id)]
    calibrations = repository.active_calibrations(session, area_ids)
    lot_model = repository.active_lot_model(session, site_id)
    polygons = {area.parking_area_id: area.polygon for area in LotModelDefinition.model_validate(lot_model.payload).parking_areas} if lot_model else {}
    states = repository.latest_states(session, area_ids)
    now = datetime.now(UTC)
    limit = freshness_limit_s()
    frames = repository.frame_sizes(session, {area_id: state.processed_at for area_id, state in states.items()})
    return SiteParkingStateResponse(
        site_id=site_id,
        generated_at=now,
        freshness_limit_s=limit,
        areas=[_with_frame(place_area_state(
            evaluate_area_state(area_id, stored=states.get(area_id), active_calibration_version=calibrations[area_id].version if area_id in calibrations else None, now=now, freshness_limit_s=limit),
            calibrations[area_id].payload if area_id in calibrations else {}, polygons.get(area_id),
        ), frames.get(area_id)) for area_id in area_ids],
    )


_guard_booth_classifier = GuardBoothClipClassifier()


def _guard_booth_preview_enabled(site_id: str) -> bool:
    return site_id == "sripatum" and os.getenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW") == "1"


def _require_guard_booth_preview(site_id: str) -> None:
    if not _guard_booth_preview_enabled(site_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


def _guard_booth_clip(site_id: str) -> GuardBoothClip:
    _require_guard_booth_preview(site_id)
    clip = configured_clip()
    if clip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Guard Booth clip is configured.")
    return clip


@app.get(
    "/api/sites/{site_id}/guard-booth-clip",
    response_class=FileResponse,
    responses={200: {"content": {"video/mp4": {}, "video/webm": {}}, "description": "The entrance stand-in clip."}, 404: {"description": "No clip is configured."}},
)
def get_guard_booth_clip(site_id: str = SiteId) -> FileResponse:
    clip = _guard_booth_clip(site_id)
    return FileResponse(clip.path, media_type=clip.media_type, headers={"Cache-Control": "no-store"})


@app.get(
    "/api/sites/{site_id}/guard-booth-classification",
    response_model=GuardBoothClassification,
    responses={503: {"description": "Still classifying the clip when `Retry-After` is set; otherwise unavailable."}},
)
def classify_guard_booth_clip(response: Response, site_id: str = SiteId) -> GuardBoothClassification:
    clip = _guard_booth_clip(site_id)
    response.headers["Cache-Control"] = "no-store"
    try:
        evidence = _guard_booth_classifier.evidence(clip)
    # An unreadable clip (HTTPException from the video pipeline) and missing checkpoints are operator setup problems.
    except (HTTPException, ModelUnavailableError, ImportError, KeyError, OSError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Guard Booth classification is unavailable.") from error
    if evidence is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Guard Booth classification is still running.",
            headers={"Retry-After": str(CLASSIFICATION_RETRY_S), "Cache-Control": "no-store"},
        )
    return summarize(evidence, clip.zone, load_rules())


@app.post("/api/sites/{site_id}/guard-booth-fit", response_model=GuardBoothFit)
def reserve_guard_booth_fit(request: GuardBoothFitRequest, site_id: str = SiteId, session: Session = SessionDependency) -> GuardBoothFit:
    _require_guard_booth_preview(site_id)
    result = reserve_parking_hold(session, site_id, request, "GUARD_BOOTH", lambda: _hold_context(site_id, session), datetime.now(UTC))
    session.commit()
    result.holds = [h for h in result.holds if h.channel == "GUARD_BOOTH"]
    return result


class LineParkingRequest(GuardBoothFitRequest):
    owner_key: str = Field(pattern=r"^[0-9a-f]{64}$", repr=False)


@app.post("/api/sites/{site_id}/parking-recommendation", response_model=GuardBoothFit)
def recommend_line_parking(request: LineParkingRequest, site_id: str = SiteId, session: Session = SessionDependency) -> GuardBoothFit:
    # Called by the trusted LIFF server with its verified saved model. The Python
    # API is private, just as its other operator and map endpoints are.
    _require_guard_booth_preview(site_id)
    result = reserve_parking_hold(session, site_id, request, "LINE", lambda: _hold_context(site_id, session), datetime.now(UTC), owner_key=request.owner_key)
    session.commit()
    result.holds = [h for h in result.holds if h.request_id == result.request_id]
    return result


@app.get("/api/sites/{site_id}/parking-recommendation", response_model=GuardBoothFit | None)
def read_line_parking(site_id: str = SiteId, owner_key: str = Header(default="", alias="X-Parkmap-Owner"), session: Session = SessionDependency):
    _require_guard_booth_preview(site_id)
    if not re.fullmatch(r"[0-9a-f]{64}", owner_key):
        raise HTTPException(403, "Verified owner required.")
    result = owner_recommendation(session, site_id, owner_key, lambda: _hold_context(site_id, session), datetime.now(UTC))
    session.commit()
    return result


@app.get("/api/sites/{site_id}/parking-holds", response_model=list[GuardBoothFitHold])
def get_parking_holds(site_id: str = SiteId, session: Session = SessionDependency) -> list[GuardBoothFitHold]:
    _require_guard_booth_preview(site_id)
    result = parking_holds_snapshot(session, site_id, lambda: _hold_context(site_id, session), datetime.now(UTC))
    session.commit()
    return [h for h in result if h.channel == "GUARD_BOOTH"]


def _preview_geometry(site_id: str, session: Session):
    """The recommendation area's lot model, area, active calibration and placement; None where missing."""
    model = get_lot_model(site_id, session)
    area_model = next((area for area in model.parking_areas if area.parking_area_id == "sripatum-near-lot"), None)
    calibration = repository.active_calibrations(session, [area_model.parking_area_id]).get(area_model.parking_area_id) if area_model else None
    placement = placement_for_calibration(calibration.payload, area_model.polygon) if area_model and calibration else None
    return model, area_model, calibration, placement


def _hold_context(site_id: str, session: Session) -> HoldContext:
    model, area_model, calibration, placement = _preview_geometry(site_id, session)
    entrance = next((landmark.position for landmark in model.landmarks if landmark.landmark_id == "entrance-1" and landmark.kind == "ENTRANCE"), None)
    if entrance is None or area_model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    area_id = area_model.parking_area_id
    if placement is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Parking geometry is unavailable.")
    state = _site_parking_state(site_id, session)
    area = next(area for area in state.areas if area.parking_area_id == area_id)
    return HoldContext(area=area, entrance=entrance, scale=placement.scale, geometry_version=f"{calibration.version}:lot-{model.version}")


def _route_editor_geometry(site_id: str, session: Session):
    _require_guard_booth_preview(site_id)
    model, area, calibration, placement = _preview_geometry(site_id, session)
    entrance = next((item.position for item in model.landmarks if item.landmark_id == "entrance-1"), None)
    if area is None or calibration is None or placement is None or entrance is None:
        raise HTTPException(503, "Parking geometry is unavailable.")
    payload = calibration.payload
    rows = parking_analysis_service._measured_rows(payload["ground_plane_homography.json"],
        payload["ground_plane_calibration.json"], payload["parking_calibration.json"])
    boundary = polygon_shape(area.polygon)
    placed = {row_id: Polygon([(p.x_m, p.y_m) for x, y in row.exterior.coords
              for p in [placement.point(MetricGroundPoint(x_m=x, y_m=y))]]).intersection(boundary)
              for row_id, row in rows}
    return model, entrance, placed


@app.exception_handler(RouteSettingsUnavailable)
async def route_settings_error(_request, error):
    return JSONResponse({"detail": str(error)}, status_code=503)


def _route_editor_state(session: Session) -> RouteEditorState:
    model, entrance, rows = _route_editor_geometry("sripatum", session)
    stored = route_settings.read()
    defaults = default_routes(entrance)
    configuration = stored.configuration or defaults
    return RouteEditorState(revision=stored.revision, configuration=configuration, defaults=defaults,
                            lot_model=model, entrance=entrance, previews=preview_routes(rows, entrance, configuration))


@app.get("/api/operator/route-editor", response_model=RouteEditorState, dependencies=[Depends(require_editor_token)])
def get_route_editor(session: Session = SessionDependency):
    return _route_editor_state(session)


@app.put("/api/operator/route-editor", response_model=RouteEditorState, dependencies=[Depends(require_editor_token)])
def save_route_editor(request: RouteWrite, session: Session = SessionDependency):
    model, _, _ = _route_editor_geometry("sripatum", session)
    if model.version != request.expected_lot_version:
        raise HTTPException(409, "Lot model changed; reload before saving routes")
    try:
        route_settings.save(request.configuration, request.expected_revision)
    except RouteConflict as error:
        raise HTTPException(409, str(error)) from error
    except OSError as error:
        raise HTTPException(503, "Could not save local routes") from error
    return _route_editor_state(session)


@app.post("/api/operator/route-editor/preview", response_model=list[RowRoutePreview], dependencies=[Depends(require_editor_token)])
def preview_route_editor(configuration: RouteConfiguration, session: Session = SessionDependency):
    _, entrance, rows = _route_editor_geometry("sripatum", session)
    return preview_routes(rows, entrance, configuration)


def _frame_version(processed_at: datetime) -> int:
    return (processed_at - EPOCH) // timedelta(microseconds=1)


def _with_frame(state: ParkingAreaLiveState, frame: tuple[datetime, int, int] | None) -> ParkingAreaLiveState:
    """Link the photo only to a shown state computed from that very photo (ADR 0017)."""
    if frame is None or state.status not in ("LIVE", "DEMO") or state.processed_at != frame[0]:
        return state
    processed_at, width, height = frame
    url = f"/api/parking-areas/{state.parking_area_id}/frame?v={_frame_version(processed_at)}"
    return state.model_copy(update={"frame": AreaFrameLink(url=url, width=width, height=height)})


@app.get(
    "/api/parking-areas/{area_id}/frame",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}, "description": "The analysed photo."}, 404: {"description": "No photo of this version."}},
)
def get_area_frame(v: int, area_id: str = AreaId, session: Session = SessionDependency) -> Response:
    """A versioned photo never changes, so it is cached for good; one past the freshness window is gone."""
    try:
        processed_at = EPOCH + timedelta(microseconds=v)
    except OverflowError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo of this version.") from None
    stored = repository.frame(session, area_id, processed_at)
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo of this version.")
    return Response(content=stored.image, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.put("/api/internal/parking-areas/{area_id}/frame", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_worker_token)])
async def ingest_area_frame(request: Request, processed_at: datetime, area_id: str = AreaId, session: Session = SessionDependency) -> Response:
    """The JPEG a worker analysed, sent before the state it published from it."""
    if request.headers.get("content-type") != "image/jpeg":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="A frame must be image/jpeg.")
    if processed_at.tzinfo is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="processed_at must include a UTC offset.")
    if (processed_at - datetime.now(UTC)).total_seconds() > MAX_FUTURE_SKEW_S:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="processed_at is in the future.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_FRAME_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The frame exceeds the size limit.")
    width, height = _jpeg_size(bytes(body))
    await run_in_threadpool(_store_frame, session, area_id, processed_at, width, height, bytes(body))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _jpeg_size(image: bytes) -> tuple[int, int]:
    try:
        with Image.open(BytesIO(image)) as decoded:
            if decoded.format != "JPEG":
                raise ValueError("Not a JPEG.")
            width, height = decoded.size
            if not (0 < width <= MAX_FRAME_EDGE_PX and 0 < height <= MAX_FRAME_EDGE_PX):
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The frame has too many pixels.")
            decoded.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The frame is not a valid JPEG.") from None
    return width, height


def _store_frame(session: Session, area_id: str, processed_at: datetime, width: int, height: int, image: bytes) -> None:
    if session.get(ParkingArea, area_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown parking area.")
    with mobile_sessions.lock:
        # A paired phone owns the area; its states carry no photo, so the worker's is not stored either.
        if mobile_sessions.owns_area(area_id):
            return
        # A state stays fresh at most the freshness limit after its photo was processed; so long, its photo loads.
        repository.store_frame(session, area_id, processed_at, width, height, image, keep_s=freshness_limit_s())
        session.commit()


@app.post("/api/internal/parking-states", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_worker_token)])
def ingest_parking_state(publish: ParkingStatePublish, session: Session = SessionDependency) -> Response:
    area = session.get(ParkingArea, publish.parking_area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown parking area.")
    if area.camera_id != publish.camera_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="camera_id does not belong to this parking area.")
    if (publish.processed_at - datetime.now(UTC)).total_seconds() > MAX_FUTURE_SKEW_S:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="processed_at is in the future.")
    with mobile_sessions.lock:
        if mobile_sessions.owns_area(publish.parking_area_id):
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        repository.lock_site(session, area.site_id)
        repository.insert_state(session, publish)
        # Reconcile the same ledger on Segment updates even without a viewer.
        # Unconfigured sites continue ingesting without recommendation geometry.
        if area.site_id == "sripatum" and os.getenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW") == "1":
            session.flush()
            try:
                parking_holds_snapshot(session, area.site_id, lambda: _hold_context(area.site_id, session), datetime.now(UTC))
            except HTTPException as error:
                if error.status_code not in (404, 503):
                    raise
        try:
            session.commit()
        except IntegrityError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Parking state could not be stored.") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/calibration", response_model=ParkingCalibration)
def get_calibration() -> ParkingCalibration:
    calibration = calibration_service.load()
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parking calibration is not configured.")
    return calibration


@app.post("/api/calibration", response_model=ParkingCalibration)
def save_calibration(calibration: ParkingCalibration) -> ParkingCalibration:
    return calibration_service.save(calibration)


@app.get("/api/ground-plane-calibration", response_model=GroundPlaneCalibrationResponse)
def get_ground_plane_calibration() -> GroundPlaneCalibrationResponse:
    try:
        return ground_plane_calibration_service.response(ground_plane_calibration_service.load())
    except FileNotFoundError:
        parking = calibration_service.load()
        if parking is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parking calibration is required before ground-plane setup.") from None
        return ground_plane_calibration_service.response(GroundPlaneCalibration(
            camera_id=parking.camera_id,
            reference_image=parking.reference_image,
            coordinate_system={"unit": "meter", "description": "Local ground-plane coordinates."},
        ))


@app.post("/api/ground-plane-calibration", response_model=GroundPlaneCalibrationResponse)
def save_ground_plane_calibration(calibration: GroundPlaneCalibration) -> GroundPlaneCalibrationResponse:
    try:
        return ground_plane_calibration_service.save(calibration)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Ground-plane calibration could not be persisted and verified: {error}") from error


@app.get("/api/ground-plane/homography", response_model=GroundPlaneHomographyResponse)
def get_ground_plane_homography() -> GroundPlaneHomographyResponse:
    try:
        return ground_plane_homography_service.get_response(ground_plane_calibration_service.load())
    except FileNotFoundError:
        return GroundPlaneHomographyResponse(
            status="INPUT_NOT_READY",
            current=False,
            row_validation_current=False,
            message="Add at least four ground-control points, then calculate the map.",
            result=None,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Ground-plane homography could not be loaded: {error}") from error


@app.post("/api/ground-plane/homography/calculate", response_model=GroundPlaneHomographyResponse)
def calculate_ground_plane_homography() -> GroundPlaneHomographyResponse:
    try:
        calibration = ground_plane_calibration_service.load()
        parking = calibration_service.load()
        if parking is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Parking calibration is required for metric geometry diagnostics.")
        return ground_plane_homography_service.calculate(calibration, parking)
    except HomographyInputError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except HTTPException:
        raise
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Ground-plane homography could not be calculated and verified: {error}") from error


@app.get("/api/physical-row-geometry")
def get_physical_row_geometry() -> dict:
    calibration = ground_plane_calibration_service.load()
    parking = calibration_service.load()
    if parking is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Parking calibration is required.")
    homography = ground_plane_homography_service.get_response(calibration)
    config = physical_row_geometry_service.load(calibration)
    current_fingerprint = measurement_fingerprint(calibration)
    if config.rows and config.measurement_source_fingerprint != current_fingerprint:
        config = config.model_copy(update={"measurement_source_fingerprint": current_fingerprint})
        try:
            config = physical_row_geometry_service.save(config)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Physical row endpoints could not be refreshed: {error}") from error
    return physical_row_geometry_service.response(config, calibration, parking, homography)


@app.post("/api/physical-row-geometry")
def save_physical_row_geometry(config: PhysicalRowGeometryConfig) -> dict:
    calibration = ground_plane_calibration_service.load()
    parking = calibration_service.load()
    if parking is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Parking calibration is required.")
    if config.camera_id != calibration.camera_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Physical endpoint camera_id does not match ground-plane calibration.")
    refreshed = config.model_copy(update={"measurement_source_fingerprint": measurement_fingerprint(calibration)})
    try:
        verified = physical_row_geometry_service.save(refreshed)
        return physical_row_geometry_service.response(verified, calibration, parking, ground_plane_homography_service.get_response(calibration))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Physical row endpoints could not be persisted and verified: {error}") from error


@app.get("/api/motorcycle-fitting", response_model=MotorcycleFittingResponse)
def get_motorcycle_fitting() -> MotorcycleFittingResponse:
    try:
        return motorcycle_fitting_service.get_response()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Motorcycle fitting configuration could not be loaded: {error}") from error


@app.post("/api/motorcycle-fitting", response_model=MotorcycleFittingResponse)
def save_motorcycle_fitting(configuration: MotorcycleFittingConfiguration) -> MotorcycleFittingResponse:
    return motorcycle_fitting_service.save(configuration)


@app.post("/api/detection/analyze", response_model=DetectionResponse)
async def analyze_detection(image: UploadFile = ImageFile, include_parking: bool = True) -> DetectionResponse:
    if image.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Supported image types are JPEG, PNG, and WebP.")

    image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
    await image.close()
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded image is empty.")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The uploaded image exceeds the configured size limit.")

    try:
        with Image.open(BytesIO(image_bytes)) as decoded:
            if decoded.format != IMAGE_FORMATS[image.content_type]:
                raise ValueError("Image format does not match the declared content type.")
            width, height = decoded.size
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The uploaded image has too many pixels.")
            decoded.verify()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is not a valid supported image.") from None

    if width <= 0 or height <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded image has invalid dimensions.")
    try:
        detection = await run_in_threadpool(cv_service.analyze_image, image_bytes)
    except ModelUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    if not include_parking:
        return detection
    try:
        analysis = await run_in_threadpool(parking_analysis_service.analyze, detection)
    except ParkingCalibrationUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    return {**detection.model_dump(mode="json"), "parking_analysis": analysis}


@app.get("/api/hybrid-parking/state")
def get_hybrid_parking_state() -> dict[str, object]:
    """Read-only Hybrid snapshot with backend-owned ROI only.

    Row calibration is intentionally not exposed by this endpoint.
    """
    snapshot=FilePath(__file__).resolve().parent.parent/'hybrid-parking-experimental'/'current_state.json'
    if snapshot.exists():
        try: state=json.loads(snapshot.read_text(encoding='utf-8'))
        except (OSError,json.JSONDecodeError) as error: raise HTTPException(status_code=500,detail="Hybrid snapshot unavailable") from error
    else:
        state={"status":"WAITING_FOR_HYBRID_ANALYSIS","updated_at":None,"rows":[],"unknown_anchors":[],"detections":[],"summary":{"detected":0,"inside_roi":0},"availability":"NOT_ESTIMATED"}
    calibration=calibration_service.load()
    state.update({"mode":"HYBRID","source_type":"HYBRID_SNAPSHOT","roi":{"polygon":[point.model_dump(mode="json") for point in calibration.parking_roi.polygon]} if calibration else None})
    return state

@app.get("/api/calibrated/state")
async def get_calibrated_state() -> dict[str, object]:
    """Read-only calibrated geometry state for the unified web viewer."""
    calibration = calibration_service.load()
    if calibration is None:
        return {"mode":"CALIBRATED","status":"NOT_CONFIGURED","source_type":"CALIBRATION_CONFIG","rows":[],"detections":[],"roi":None,"availability":"NOT_ESTIMATED"}
    rows=[]
    for row in calibration.rows:
        points=[point.model_dump(mode="json") for point in row.polygon]
        rows.append({"row_id":row.id,"display_id":row.id.replace("row_","R"),"status":"CONFIGURED","polygon":points,"centerline":points[:2]})
    latest_image=FilePath(__file__).resolve().parent.parent/'hybrid-parking-experimental'/'latest_image'
    updated_at=datetime.fromtimestamp(calibration_service.calibration_path.stat().st_mtime, UTC).isoformat()
    image_meta={"url":"/api/hybrid-parking/latest/image","width":calibration.reference_image.width,"height":calibration.reference_image.height} if latest_image.exists() else None
    parking_analysis=None
    detections=[]
    if latest_image.exists():
        try:
            image_bytes=latest_image.read_bytes()
            detection=await run_in_threadpool(cv_service.analyze_image, image_bytes)
            parking_analysis=await run_in_threadpool(parking_analysis_service.analyze, detection)
            image_meta={"url":"/api/hybrid-parking/latest/image","width":detection.image_width,"height":detection.image_height}
            detections=[]
            roi_polygon=calibration.parking_roi.polygon
            for item in detection.detections:
                payload=item.model_dump(mode="json")
                bbox=payload["bbox"]
                point={"x":bbox["x"] + bbox["width"] / 2, "y":bbox["y"] + bbox["height"]}
                payload["point"] = point
                payload["inside_roi"] = _normalized_point_in_polygon(point["x"], point["y"], roi_polygon)
                detections.append(payload)
        except (OSError, ModelUnavailableError, ParkingCalibrationUnavailableError, ValueError):
            parking_analysis=None
    hybrid_snapshot=FilePath(__file__).resolve().parent.parent/'hybrid-parking-experimental'/'current_state.json'
    if not detections and hybrid_snapshot.exists():
        try:
            snapshot=json.loads(hybrid_snapshot.read_text(encoding="utf-8"))
            detections=snapshot.get("detections",[])
        except (OSError, json.JSONDecodeError):
            detections=[]
    return {"mode":"CALIBRATED","status":"READY","source_type":"CALIBRATION_CONFIG","updated_at":updated_at,"rows":rows,"detections":detections,"image":image_meta,"roi":{"polygon":[point.model_dump(mode="json") for point in calibration.parking_roi.polygon]},"parking_analysis":parking_analysis,"availability":"NOT_ESTIMATED"}

def _normalized_point_in_polygon(x: float, y: float, polygon: list[object]) -> bool:
    inside = False
    for index, point in enumerate(polygon):
        previous = polygon[index - 1]
        if ((point.y > y) != (previous.y > y)) and x < (previous.x - point.x) * (y - point.y) / ((previous.y - point.y) or 1e-12) + point.x:
            inside = not inside
    return inside

@app.post("/api/hybrid-parking/analyze")
async def analyze_hybrid_parking(image: UploadFile = ImageFile) -> dict[str, object]:
    """Run YOLO and return detections classified only against backend ROI."""
    calibration = calibration_service.load()
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Hybrid ROI is not configured.")
    if image.content_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Supported image types are JPEG, PNG, and WebP.")
    image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
    await image.close()
    if not image_bytes or len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The uploaded image is empty or exceeds the configured size limit.")
    try:
        with Image.open(BytesIO(image_bytes)) as decoded:
            if decoded.format != IMAGE_FORMATS[image.content_type]:
                raise ValueError("Image format does not match the declared media type.")
            decoded.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is not a valid supported image.") from error
    try:
        detection = await run_in_threadpool(cv_service.analyze_image, image_bytes)
    except ModelUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    roi = calibration.parking_roi.polygon
    detections = []
    occupied_regions = []
    for index, item in enumerate(detection.detections, 1):
        bbox = item.bbox
        point = {"x": bbox.x + bbox.width / 2, "y": bbox.y + bbox.height}
        inside_roi = _normalized_point_in_polygon(point["x"], point["y"], roi)
        bbox_corners = [(bbox.x, bbox.y), (bbox.x + bbox.width, bbox.y), (bbox.x + bbox.width, bbox.y + bbox.height), (bbox.x, bbox.y + bbox.height)]
        bbox_intersects_roi = any(_normalized_point_in_polygon(x, y, roi) for x, y in bbox_corners) or any(bbox.x <= vertex.x <= bbox.x + bbox.width and bbox.y <= vertex.y <= bbox.y + bbox.height for vertex in roi)
        detection_id = f"detection_{index}"
        detections.append({"detection_id": detection_id, "confidence": item.confidence, "bbox": bbox.model_dump(mode="json"), "point": point, "inside_roi": inside_roi, "bbox_intersects_roi": bbox_intersects_roi})
        if inside_roi:
            occupied_regions.append({"region_id": f"occupied_{index}", "detection_id": detection_id, "coordinate_space": "NORMALIZED_IMAGE", "polygon":[{"x":bbox.x,"y":bbox.y},{"x":bbox.x+bbox.width,"y":bbox.y},{"x":bbox.x+bbox.width,"y":bbox.y+bbox.height},{"x":bbox.x,"y":bbox.y+bbox.height}],"status":"OCCUPIED_EVIDENCE"})
    roi_detections=[item for item in detection.detections if _normalized_point_in_polygon(item.bbox.x + item.bbox.width / 2, item.bbox.y + item.bbox.height, roi)]
    roi_detection=detection.model_copy(update={"detections": roi_detections})
    auto_analysis = analyze_detections([(image.filename or "hybrid_image", roi_detection)])
    inferred_rows = auto_analysis["rows"]
    corridors = [{"corridor_id": f"corridor_{row['row_id']}", "row_id": row["row_id"], "coordinate_space": row["coordinate_space"], "polygon": row["polygon"], "support_status": row["status"]} for row in inferred_rows if row["status"] == "SUPPORTED"]
    result={"mode":"HYBRID","status":"READY","source_type":"HYBRID_ANALYSIS","updated_at":datetime.now(UTC).isoformat(),"roi":{"polygon":[point.model_dump(mode="json") for point in roi]},"rows":inferred_rows,"rejected_observations":auto_analysis["rejected_observations"],"parking_corridors":corridors,"unknown_anchors":[],"detections":detections,"occupied_regions":occupied_regions,"summary":{"detected":len(detections),"inside_roi":sum(1 for item in detections if item["inside_roi"]),"inferred_rows":len(inferred_rows),"supported_corridors":len(corridors)},"availability":"NOT_ESTIMATED"}
    snapshot=FilePath(__file__).resolve().parent.parent/'hybrid-parking-experimental'/'current_state.json'
    snapshot.parent.mkdir(parents=True,exist_ok=True)
    image_path=snapshot.parent/'latest_image'
    image_path.write_bytes(image_bytes)
    result["image"]={"url":"/api/hybrid-parking/latest/image","width":detection.image_width,"height":detection.image_height}
    snapshot.write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result

@app.get("/api/hybrid-parking/latest/image")
def get_hybrid_latest_image() -> FileResponse:
    image_path=FilePath(__file__).resolve().parent.parent/'hybrid-parking-experimental'/'latest_image'
    if not image_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Hybrid image has been analyzed yet.")
    return FileResponse(image_path)
