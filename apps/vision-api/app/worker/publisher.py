from datetime import datetime

import cv2
import httpx
import numpy as np

from app.models import ParkingStatePublish

INGEST_PATH = "/api/internal/parking-states"
FRAME_PATH = "/api/internal/parking-areas/{area_id}/frame"
# LIFF shows the photo in a phone drawer: this keeps it sharp there and well inside the API's limits.
FRAME_LONG_EDGE_PX = 1600
FRAME_JPEG_QUALITY = 80


def encode_frame(image: np.ndarray) -> bytes:
    """A BGR frame as a JPEG no longer than FRAME_LONG_EDGE_PX on its long edge."""
    height, width = image.shape[:2]
    scale = FRAME_LONG_EDGE_PX / max(width, height)
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    encoded, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, FRAME_JPEG_QUALITY])
    if not encoded:
        raise ValueError("The frame could not be encoded as JPEG.")
    return jpeg.tobytes()


class StatePublisher:
    """Sends parking states, and the photo each was derived from, to the API (ADR 0017)."""

    def __init__(self, api_url: str, token: str, *, timeout_s: float = 5.0, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(base_url=api_url, headers={"Authorization": f"Bearer {token}"}, timeout=timeout_s, transport=transport)

    def publish(self, state: ParkingStatePublish) -> None:
        response = self._client.post(INGEST_PATH, content=state.model_dump_json(), headers={"Content-Type": "application/json"})
        response.raise_for_status()

    def publish_frame(self, parking_area_id: str, processed_at: datetime, image: np.ndarray) -> None:
        response = self._client.put(
            FRAME_PATH.format(area_id=parking_area_id),
            params={"processed_at": processed_at.isoformat()},
            content=encode_frame(image),
            headers={"Content-Type": "image/jpeg"},
        )
        response.raise_for_status()

    def close(self) -> None:
        self._client.close()
