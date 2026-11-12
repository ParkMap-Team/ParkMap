"""Scoped phone ingress; editor credentials never cross into the phone browser."""

import base64
import io
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import numpy as np
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db import repository
from app.db.session import get_session
from app.db.tables import ParkingArea
from app.models import IDENTIFIER_PATTERN, GroundPlaneCalibration, ParkingCalibration
from app.operator_auth import require_editor_token
from app.services.cv_service import ModelUnavailableError
from app.services.frame_analysis_service import analyze_segmentation_frame
from app.services.ground_plane_homography_service import (
    GroundPlaneHomographyService,
    transform_point,
)
from app.services.live_state_service import calibration_identity
from app.services.lot_placement_service import placement_for_calibration
from app.services.mobile_camera_sessions import MobileSessionError, mobile_sessions

SessionDependency = Depends(get_session)

CONFIG = Path(__file__).resolve().parents[1] / "config"
MAX_FRAME_BYTES = 8 * 1024 * 1024
operator_router = APIRouter(prefix="/api/operator/mobile-camera", dependencies=[Depends(require_editor_token)], tags=["Mobile camera"])
public_router = APIRouter(prefix="/api/mobile-camera", tags=["Mobile camera"])


class PairRequest(BaseModel):
    parking_area_id: str = Field(pattern=IDENTIFIER_PATTERN)
    mobile_origin: str = Field(max_length=250)


class ClaimRequest(BaseModel):
    pairing_token: str = Field(min_length=20, max_length=100)


class ApproveRequest(BaseModel):
    preview_revision: int = Field(ge=1)


def current_configuration():
    try:
        version, _ = calibration_identity(CONFIG)
        parking = ParkingCalibration.model_validate_json((CONFIG / "parking_calibration.json").read_bytes())
        ground = GroundPlaneCalibration.model_validate_json((CONFIG / "ground_plane_calibration.json").read_bytes())
        response = GroundPlaneHomographyService(CONFIG).get_response(ground)
        if not response.current or response.status != "VALIDATED" or response.result is None:
            raise ValueError()
        points = [transform_point(p.x, p.y, response.result.matrix) for p in parking.parking_roi.polygon]
        expected = [(p.x_m, p.y_m) for p in response.result.roi_metric.points]
        if len(points) != len(expected) or any(p is None or abs(p[0]-q[0])+abs(p[1]-q[1]) > 1e-6 for p, q in zip(points, expected, strict=True)):
            raise ValueError()
        return version, parking
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(409, "Save and validate matching camera calibration first") from error


def status_of(item, *, private=False):
    data = {"session_id": item.id, "state": item.state, "preview_revision": item.revision,
        "reference_image": item.parking["reference_image"], "rows": item.parking["rows"],
        "result": item.result or None, "remaining_s": max(0, int(item.expires-mobile_sessions.clock())),
        "freshness_limit_s": float(os.getenv("PARKMAP_STATE_FRESHNESS_S", "15")),
        "result_age_s": max(0, (datetime.now(UTC)-item.last_state.observed_at).total_seconds()) if item.last_state else 0}
    if private:
        data["preview_url"] = item.preview_url
    return data


def upload_session(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Scan a new pairing QR first")
    return mobile_sessions.authorize(authorization[7:])


UploadDependency = Depends(upload_session)


@operator_router.post("/sessions")
def create_pair(request: PairRequest, session: Session = SessionDependency):
    origin = urlsplit(request.mobile_origin)
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in {"", "/"} or origin.query or origin.fragment:
        raise HTTPException(422, "Enter an HTTPS origin, for example https://your-phone-link.example")
    version, parking = current_configuration()
    area = session.get(ParkingArea, request.parking_area_id)
    if area is None or area.camera_id != parking.camera_id:
        raise HTTPException(409, "Choose the parking area belonging to this calibration camera")
    active = repository.active_calibrations(session, [area.id]).get(area.id)
    lot = repository.active_lot_model(session, area.site_id)
    target = next((p["polygon"] for p in lot.payload["parking_areas"] if p["parking_area_id"] == area.id), None) if lot else None
    from app.models import MetricGroundPoint
    target = [[MetricGroundPoint.model_validate(p) for p in ring] for ring in target] if target else None
    if active is None or active.version != version or placement_for_calibration(active.payload, target) is None:
        raise HTTPException(409, "Register calibration and align the LIFF lot ROI first")
    item, pair = mobile_sessions.create(area.id, area.camera_id, version, parking.model_dump(mode="json"))
    join = f"{origin.scheme}://{origin.netloc}/mobile-camera#pair={pair}"
    qr = qrcode.make(join, image_factory=qrcode.image.svg.SvgPathImage)
    return {**status_of(item), "join_url": join, "qr_svg": qr.to_string(encoding="unicode"), "pair_expires_in_s": 120}


@public_router.post("/claim")
def claim(request: ClaimRequest):
    token = mobile_sessions.claim(request.pairing_token)
    return {**status_of(mobile_sessions.authorize(token)), "access_token": token}


@operator_router.get("/sessions/{key}")
def operator_status(key: str):
    return status_of(mobile_sessions.get(key), private=True)


@public_router.get("/status")
def phone_status(item=UploadDependency):
    return status_of(item)


@operator_router.post("/sessions/{key}/approve")
def approve(key: str, request: ApproveRequest):
    item = mobile_sessions.get(key)
    if current_configuration()[0] != item.calibration:
        mobile_sessions.stop(key)
        raise HTTPException(409, "Calibration changed; pair again")
    mobile_sessions.approve(key, request.preview_revision)
    return status_of(item)


def stop_session(item, session):
    with mobile_sessions.lock:
        mobile_sessions.get(item.id)
        mobile_sessions.stop(item.id)
        if item.last_state is not None:
            unknown = [r for r in item.last_state.regions if r.kind == "UNKNOWN"]
            cleared = item.last_state.model_copy(update={"regions": unknown, "motorcycles": [], "processed_at": datetime.now(UTC)})
            repository.insert_state(session, cleared)
            session.commit()
    return {"state": "STOPPED"}


@operator_router.post("/sessions/{key}/stop")
def operator_stop(key: str, session: Session = SessionDependency):
    return stop_session(mobile_sessions.get(key), session)


@public_router.post("/stop")
def phone_stop(item=UploadDependency, session: Session = SessionDependency):
    return stop_session(item, session)


def normalize_phone_image(raw, reference):
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"} or source.width*source.height > 25_000_000:
                raise ValueError("Unsupported or oversized image")
            decoded = ImageOps.exif_transpose(source).convert("RGB")
            width, height = reference["width"], reference["height"]
            if width*height > 25_000_000:
                raise ValueError("Calibration reference image is too large for phone streaming")
            if abs((decoded.width/decoded.height)/(width/height)-1) > .007:
                raise ValueError(
                    f"Camera aspect ratio differs from calibration: received {decoded.width}x{decoded.height}, "
                    f"expected ratio {width}x{height}; rotate the phone or choose matching camera settings"
                )
            decoded = decoded.resize((width, height), Image.Resampling.LANCZOS)
            thumb = decoded.copy()
            thumb.thumbnail((960, 720))
            stream = io.BytesIO()
            thumb.save(stream, "JPEG", quality=80)
            return cv2.cvtColor(np.asarray(decoded), cv2.COLOR_RGB2BGR), "data:image/jpeg;base64,"+base64.b64encode(stream.getvalue()).decode()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Invalid camera image") from error


def process_frame(raw, item, sequence, received_at, session):
    with mobile_sessions.lock:
        mobile_sessions.get(item.id)
        if current_configuration()[0] != item.calibration:
            mobile_sessions.stop(item.id)
            raise HTTPException(409, "Calibration changed; pair again")
    image, preview = normalize_phone_image(raw, item.parking["reference_image"])
    mobile_sessions.preview(item, preview, sequence+1)
    if item.state != "LIVE":
        return status_of(item)
    if not mobile_sessions.analysis_lock.acquire(blocking=False):
        raise HTTPException(429, "Another camera frame is being analyzed; retry")
    try:
        state = analyze_segmentation_frame(image, received_at, parking_area_id=item.area, source="LIVE_CAMERA")
    finally:
        mobile_sessions.analysis_lock.release()
    with mobile_sessions.lock:
        mobile_sessions.get(item.id)
        if item.state != "LIVE" or state.calibration_version != item.calibration or current_configuration()[0] != item.calibration:
            raise HTTPException(409, "Session or calibration changed during analysis")
        if (datetime.now(UTC)-received_at).total_seconds() > float(os.getenv("PARKMAP_STATE_FRESHNESS_S", "15")):
            raise HTTPException(409, "Analysis took too long; sending the next live frame")
        area = session.get(ParkingArea, item.area)
        active = repository.active_calibrations(session, [item.area]).get(item.area)
        if area is None or area.camera_id != item.camera or active is None or active.version != item.calibration:
            raise HTTPException(409, "Registered camera calibration changed")
        repository.insert_state(session, state)
        session.commit()
        item.last_state = state
        inverse = json.loads((CONFIG / "ground_plane_homography.json").read_text())["inverse_matrix"]
        overlays = []
        for region in state.regions:
            rings = [[transform_point(p.x_m, p.y_m, inverse) for p in ring] for ring in region.polygon]
            if all(p is not None and all(0 <= value <= 1 for value in p) for ring in rings for p in ring):
                overlays.append({"kind": region.kind, "rings": rings})
        item.result = {"cars": len(state.motorcycles), "green_count": sum(r.kind == "WIDTH_SUFFICIENT" for r in state.regions),
            "processed_at": state.processed_at.isoformat(), "image_regions": overlays}
        return status_of(item)


@public_router.post("/frame")
async def frame(request: Request, x_frame_sequence: int = Header(ge=0), item=UploadDependency, session: Session = SessionDependency):
    received_at = datetime.now(UTC)
    if request.headers.get("content-type", "").split(";")[0] not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Send a JPEG/PNG/WebP camera frame")
    # Raw bytes avoid UploadFile's disk-spooling path for private live frames.
    item = mobile_sessions.begin_frame(request.headers["authorization"][7:], x_frame_sequence)
    try:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_FRAME_BYTES:
                raise HTTPException(413, "Camera frame exceeds 8 MB")
        return await run_in_threadpool(process_frame, bytes(raw), item, x_frame_sequence, received_at, session)
    except ModelUnavailableError as error:
        raise HTTPException(503, "Configured Seg model is unavailable; check the local model settings") from error
    except MobileSessionError:
        raise
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    finally:
        mobile_sessions.end_frame(item)
