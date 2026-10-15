import argparse
import json
from datetime import UTC, datetime, timedelta

import httpx
import numpy as np
import pytest

from app.manage import dev_state
from app.services.live_state_service import CalibrationFilesUnavailableError
from app.worker.__main__ import reference_size, source_kind, utc_offset
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


def test_source_kind_labels_recorded_video_photo_directories_and_cameras(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"")

    assert source_kind("rtsp://camera.local/stream") == "LIVE_CAMERA"
    assert source_kind(str(video)) == "RECORDED_REPLAY"
    assert source_kind(str(tmp_path)) == "STILL_IMAGE_LOOP"
    with pytest.raises(ValueError):
        source_kind(str(tmp_path / "missing.mp4"))


def test_photo_utc_offset_is_parsed_or_rejected():
    assert utc_offset("+07:00").utcoffset(None) == timedelta(hours=7)
    with pytest.raises(argparse.ArgumentTypeError):
        utc_offset("Asia/Bangkok")


def test_reference_size_comes_from_the_parking_calibration(tmp_path):
    polygon = [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.9, "y": 0.9}]
    calibration = {"camera_id": "camera-1", "reference_image": {"width": 4032, "height": 3024}, "parking_roi": {"polygon": polygon}, "rows": [{"id": "row_1", "name": "Row 1", "polygon": polygon}]}
    (tmp_path / "parking_calibration.json").write_text(json.dumps(calibration))

    assert reference_size(tmp_path) == (4032, 3024)
    with pytest.raises(CalibrationFilesUnavailableError):
        reference_size(tmp_path / "missing")
