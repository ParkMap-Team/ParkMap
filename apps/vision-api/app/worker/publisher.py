import httpx

from app.models import ParkingStatePublish

INGEST_PATH = "/api/internal/parking-states"


class StatePublisher:
    """Sends parking states to the API. Only derived geometry leaves the camera network."""

    def __init__(self, api_url: str, token: str, *, timeout_s: float = 5.0, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(base_url=api_url, headers={"Authorization": f"Bearer {token}"}, timeout=timeout_s, transport=transport)

    def publish(self, state: ParkingStatePublish) -> None:
        response = self._client.post(INGEST_PATH, content=state.model_dump_json(), headers={"Content-Type": "application/json"})
        response.raise_for_status()

    def close(self) -> None:
        self._client.close()
