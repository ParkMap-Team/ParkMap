import hmac
import json
import os
from pathlib import Path as FilePath
from datetime import UTC, datetime
from io import BytesIO

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Path, Response, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db import repository
from app.db.session import get_session
from app.db.tables import ParkingArea, Site
from app.models import IDENTIFIER_PATTERN, DetectionResponse, GroundPlaneCalibration, GroundPlaneCalibrationResponse, GroundPlaneHomographyResponse, HealthResponse, LotModelDefinition, LotModelResponse, MotorcycleFittingConfiguration, MotorcycleFittingResponse, ParkingCalibration, ParkingStatePublish, PhysicalRowGeometryConfig, SiteParkingStateResponse, SiteSummary
from app.services.calibration_service import calibration_service
from app.services.cv_service import ModelUnavailableError, cv_service
from app.services.motorcycle_fitting_service import motorcycle_fitting_service
from app.services.ground_plane_calibration_service import ground_plane_calibration_service
from app.services.ground_plane_homography_service import HomographyInputError, ground_plane_homography_service
from app.services.physical_row_geometry_service import measurement_fingerprint, physical_row_geometry_service
from app.services.parking_analysis_service import ParkingCalibrationUnavailableError, parking_analysis_service
from app.services.auto_parking_service import analyze_detections
from app.services.live_state_service import MAX_FUTURE_SKEW_S, evaluate_area_state, unmonitored_polygons

load_dotenv()

app = FastAPI(title="ParkMap API", version="0.2.0", description="API boundary for ParkMap monitoring and the future CV pipeline.")

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
def list_sites(session: Session = Depends(get_session)) -> list[SiteSummary]:
    return [SiteSummary(site_id=site.id, name=site.name, latitude=site.latitude, longitude=site.longitude) for site in repository.list_sites(session)]


@app.get("/api/sites/{site_id}/lot-model", response_model=LotModelResponse)
def get_lot_model(site_id: str = SiteId, session: Session = Depends(get_session)) -> LotModelResponse:
    _require_site_areas(session, site_id)
    lot_model = repository.active_lot_model(session, site_id)
    if lot_model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lot model is configured for this site.")
    definition = LotModelDefinition.model_validate(lot_model.payload)
    return LotModelResponse(**definition.model_dump(), site_id=site_id, version=lot_model.version, unmonitored=unmonitored_polygons(definition))


@app.get("/api/sites/{site_id}/parking-state", response_model=SiteParkingStateResponse)
def get_site_parking_state(site_id: str = SiteId, session: Session = Depends(get_session)) -> SiteParkingStateResponse:
    area_ids = [area.id for area in _require_site_areas(session, site_id)]
    calibrations = repository.active_calibration_versions(session, area_ids)
    states = repository.latest_states(session, area_ids)
    now = datetime.now(UTC)
    limit = freshness_limit_s()
    return SiteParkingStateResponse(
        site_id=site_id,
        generated_at=now,
        freshness_limit_s=limit,
        areas=[evaluate_area_state(area_id, stored=states.get(area_id), active_calibration_version=calibrations.get(area_id), now=now, freshness_limit_s=limit) for area_id in area_ids],
    )


@app.post("/api/internal/parking-states", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_worker_token)])
def ingest_parking_state(publish: ParkingStatePublish, session: Session = Depends(get_session)) -> Response:
    area = session.get(ParkingArea, publish.parking_area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown parking area.")
    if area.camera_id != publish.camera_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="camera_id does not belong to this parking area.")
    if (publish.observed_at - datetime.now(UTC)).total_seconds() > MAX_FUTURE_SKEW_S:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="observed_at is in the future.")
    repository.insert_state(session, publish)
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
            message="Add at least four measured ground-control points, then calculate the map.",
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
async def analyze_detection(image: UploadFile = File(...), include_parking: bool = True) -> DetectionResponse:
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


@app.post("/api/auto-parking/analyze")
async def analyze_auto_parking(images: list[UploadFile] = File(...)) -> dict[str, object]:
    """Experimental structure discovery from multiple images of one camera."""
    if not images:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one image is required.")
    responses: list[tuple[str, DetectionResponse]] = []
    aspect_ratio: float | None = None
    try:
        for image in images:
            if image.content_type not in SUPPORTED_IMAGE_TYPES:
                raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Supported image types are JPEG, PNG, and WebP.")
            image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
            await image.close()
            if not image_bytes or len(image_bytes) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="An uploaded image is empty or exceeds the configured size limit.")
            try:
                with Image.open(BytesIO(image_bytes)) as decoded:
                    if decoded.format != IMAGE_FORMATS[image.content_type]:
                        raise ValueError("Image format does not match the declared media type.")
                    width, height = decoded.size
                    if width * height > MAX_IMAGE_PIXELS:
                        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="An uploaded image has too many pixels.")
                    decoded.verify()
            except HTTPException:
                raise
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An uploaded file is not a valid supported image.") from error
            current_ratio = width / height
            if aspect_ratio is None:
                aspect_ratio = current_ratio
            elif abs(current_ratio - aspect_ratio) > 0.01:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Auto Mode images must use a compatible aspect ratio.")
            detection = await run_in_threadpool(cv_service.analyze_image, image_bytes)
            responses.append((image.filename or f"image_{len(responses) + 1}", detection))
    except ModelUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    return analyze_detections(responses)

@app.get("/api/auto-parking/state")
def get_auto_parking_state() -> dict[str, object]:
    """Read-only experimental snapshot; never runs CV inference."""
    snapshot=FilePath(__file__).resolve().parent.parent/'auto-parking-experimental'/'current_state.json'
    if not snapshot.exists(): return {"mode":"AUTO_EXPERIMENTAL","source_type":"EXPERIMENTAL_SNAPSHOT","status":"UNKNOWN","updated_at":None,"rows":[],"unknown_anchors":[],"summary":{"detection_observations":0,"anchors":0,"logical_rows":0,"unknown_anchors":0}}
    try:
        state=json.loads(snapshot.read_text(encoding='utf-8'))
        image_path=snapshot.parent/'auto_rows_v2.png'
        if image_path.exists(): state["image"]={"url":"/api/auto-parking/latest/image","width":4032,"height":3024}
        return state
    except (OSError,json.JSONDecodeError) as error: raise HTTPException(status_code=500,detail="Experimental snapshot unavailable") from error

@app.get("/api/auto-parking/latest/image")
def get_auto_latest_image() -> FileResponse:
    image_path=FilePath(__file__).resolve().parent.parent/'auto-parking-experimental'/'auto_rows_v2.png'
    if not image_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Auto image is available.")
    return FileResponse(image_path)

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
async def analyze_hybrid_parking(image: UploadFile = File(...)) -> dict[str, object]:
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
