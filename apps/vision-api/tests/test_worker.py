import json
from datetime import UTC, datetime

import httpx
import numpy as np
import pytest

from app.manage import dev_state
from app.worker.__main__ import source_kind
from app.worker.frames import Frame, LatestFrameSlot
from app.worker.publisher import StatePublisher


def frame(second):
    return Frame(image=np.zeros((1, 1, 3), dtype=np.uint8), captured_at=datetime(2026, 10, 1, 8, 0, second, tzinfo=UTC))


def test_latest_frame_slot_keeps_only_the_newest_frame():
    slot = LatestFrameSlot()
    slot.put(frame(1))
    slot.put(frame(2))

    assert slot.take().captured_at.second == 2
    assert slot.take() is None
    assert slot.dropped == 1


def test_publisher_posts_state_with_worker_token():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(204)

    publisher = StatePublisher("http://api.test", "secret", transport=httpx.MockTransport(handler))
    state = dev_state(datetime(2026, 10, 1, 8, 0, tzinfo=UTC))
    publisher.publish(state)
    publisher.close()

    request = requests[0]
    assert request.method == "POST"
    assert request.url.path == "/api/internal/parking-states"
    assert request.headers["authorization"] == "Bearer secret"
    assert json.loads(request.content)["source"] == "SYNTHETIC_FIXTURE"


def test_publisher_raises_on_rejected_state():
    publisher = StatePublisher("http://api.test", "secret", transport=httpx.MockTransport(lambda request: httpx.Response(422)))

    with pytest.raises(httpx.HTTPStatusError):
        publisher.publish(dev_state(datetime(2026, 10, 1, 8, 0, tzinfo=UTC)))


def test_source_kind_labels_recorded_video_and_cameras(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"")

    assert source_kind("rtsp://camera.local/stream") == "LIVE_CAMERA"
    assert source_kind(str(video)) == "RECORDED_REPLAY"
    with pytest.raises(ValueError):
        source_kind(str(tmp_path / "missing.mp4"))
