import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models import HealthResponse, ParkingStatusResponse
from app.services.parking_service import parking_service

app = FastAPI(title="ParkMap API", version="0.1.0", description="API boundary for ParkMap monitoring and the future CV pipeline.")

allowed_origins = [origin.strip() for origin in os.getenv("PARKMAP_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["GET"], allow_headers=["*"])


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/parking/status", response_model=ParkingStatusResponse)
def parking_status() -> ParkingStatusResponse:
    return parking_service.get_status()
