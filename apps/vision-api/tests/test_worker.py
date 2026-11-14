import argparse
import json
import threading
from datetime import UTC, datetime, timedelta

import cv2
import httpx
import numpy as np
import pytest

import app.worker.__main__ as worker
from app.manage import dev_state
from app.services.live_state_service import CalibrationFilesUnavailableError
from app.worker.__main__ import reference_size, source_kind, utc_offset
from app.worker.frames import Frame, LatestFrameSlot
from app.worker.publisher import StatePublisher, encode_frame


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


def test_publisher_puts_a_downscaled_jpeg_of_the_frame_with_its_processing_time():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(204)

    publisher = StatePublisher("http://api.test", "secret", transport=httpx.MockTransport(handler))
    processed_at = datetime(2026, 10, 1, 8, 0, 0, 123456, tzinfo=UTC)
    publisher.publish_frame("area-1", processed_at, np.full((3024, 4032, 3), 90, dtype=np.uint8))
    publisher.close()

    request = requests[0]
    assert request.method == "PUT"
    assert request.url.path == "/api/internal/parking-areas/area-1/frame"
    assert datetime.fromisoformat(request.url.params["processed_at"]) == processed_at
    assert request.headers["authorization"] == "Bearer secret"
    assert request.headers["content-type"] == "image/jpeg"
    decoded = cv2.imdecode(np.frombuffer(request.content, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[:2] == (1200, 1600)


def test_a_small_frame_is_not_enlarged():
    assert cv2.imdecode(np.frombuffer(encode_frame(np.zeros((300, 400, 3), dtype=np.uint8)), dtype=np.uint8), cv2.IMREAD_COLOR).shape[:2] == (300, 400)


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


@pytest.fixture
def worker_env(tmp_path, monkeypatch):
    test_reference_size_comes_from_the_parking_calibration(tmp_path)
    monkeypatch.setattr(worker, "CONFIG_DIRECTORY", tmp_path)
    monkeypatch.setenv("PARKMAP_API_URL", "http://api.test")
    monkeypatch.setenv("PARKMAP_WORKER_TOKEN", "worker-token")

    def no_publisher(*_args, **_kwargs):
        raise AssertionError("a worker that cannot start must not publish")

    monkeypatch.setattr(worker, "StatePublisher", no_publisher)
    return tmp_path


def worker_args(source):
    return argparse.Namespace(parking_area_id="area-1", source=str(source), min_interval_s=2.0, hold_s=10.0, photo_utc_offset=utc_offset("+07:00"))


@pytest.mark.parametrize("source", ["missing", "empty"])
def test_worker_without_photos_stops_with_a_clear_log_and_publishes_nothing(worker_env, source, caplog):
    photos = worker_env / source
    if source == "empty":
        photos.mkdir()

    assert worker.run(worker_args(photos)) == 2
    assert "cannot start" in caplog.text


@pytest.mark.parametrize("frame_fails", [False, True])
def test_worker_sends_the_photo_before_its_state_and_still_publishes_when_the_photo_fails(worker_env, monkeypatch, frame_fails, caplog):
    calls = []
    state = dev_state(datetime(2026, 10, 1, 8, 0, tzinfo=UTC))

    class OneFrame:
        def __init__(self, _source, slot, **_kwargs):
            self.finished = threading.Event()
            self.slot = slot

        def start(self):
            self.slot.put(frame(1))
            self.finished.set()

        def join(self, timeout=None):
            pass

    class Recorder:
        def __init__(self, *_args, **_kwargs):
            pass

        def publish_frame(self, area_id, processed_at, image):
            calls.append(("frame", area_id, processed_at))
            if frame_fails:
                raise httpx.ConnectError("api down")

        def publish(self, published):
            calls.append(("state", published.parking_area_id, published.processed_at))

        def close(self):
            pass

    monkeypatch.setattr(worker, "FrameGrabber", OneFrame)
    monkeypatch.setattr(worker, "StatePublisher", Recorder)
    monkeypatch.setattr(worker, "analyze_frame", lambda *_args, **_kwargs: state)
    video = worker_env / "clip.mp4"
    video.write_bytes(b"")

    args = worker_args(video)
    args.min_interval_s = 0.01

    assert worker.run(args) == 0
    assert calls == [("frame", state.parking_area_id, state.processed_at), ("state", state.parking_area_id, state.processed_at)]
    assert ("Frame photo not published" in caplog.text) is frame_fails
