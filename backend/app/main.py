import json
import os
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from app.models import DetectionResponse, HealthResponse, MetricCalibration, MetricCalibrationResponse, ParkingCalibration, ParkingStatusResponse
from app.services.calibration_service import calibration_service
from app.services.cv_service import cv_service
from app.services.metric_calibration_service import metric_calibration_service
from app.services.parking_service import parking_service

load_dotenv()

app = FastAPI(title="ParkMap API", version="0.2.0", description="API boundary for ParkMap monitoring and the future CV pipeline.")

allowed_origins = [origin.strip() for origin in os.getenv("PARKMAP_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD_BYTES = int(float(os.getenv("PARKMAP_MAX_UPLOAD_MB", "25")) * 1024 * 1024)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/parking/status", response_model=ParkingStatusResponse)
def parking_status() -> ParkingStatusResponse:
    return parking_service.get_status()


@app.get("/api/calibration", response_model=ParkingCalibration)
def get_calibration() -> ParkingCalibration:
    calibration = calibration_service.load()
    if calibration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parking calibration is not configured.")
    return calibration


@app.post("/api/calibration", response_model=ParkingCalibration)
def save_calibration(calibration: ParkingCalibration) -> ParkingCalibration:
    return calibration_service.save(calibration)


@app.get("/api/metric-calibration", response_model=MetricCalibrationResponse)
def get_metric_calibration() -> MetricCalibrationResponse:
    try:
        return metric_calibration_service.get_response()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Metric calibration could not be loaded: {error}") from error


@app.post("/api/metric-calibration", response_model=MetricCalibrationResponse)
def save_metric_calibration(calibration: MetricCalibration) -> MetricCalibrationResponse:
    return metric_calibration_service.save(calibration)


@app.post("/api/detection/analyze", response_model=DetectionResponse)
async def analyze_detection(image: UploadFile = File(...)) -> DetectionResponse:
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
            decoded.verify()
        with Image.open(BytesIO(image_bytes)) as decoded:
            width, height = decoded.size
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is not a valid supported image.") from None

    if width <= 0 or height <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded image has invalid dimensions.")
    return cv_service.analyze_image(image_bytes=image_bytes)
