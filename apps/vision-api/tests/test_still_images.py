from datetime import UTC, datetime, timedelta, timezone

import cv2
import numpy as np
import pytest

from app.worker.frames import LatestFrameSlot
from app.worker.still_images import (
    StillImageError,
    StillImageLoop,
    load_still_images,
    photo_time,
)

BANGKOK = timezone(timedelta(hours=7))
NOW = datetime(2026, 10, 15, 8, 0, tzinfo=UTC)


def write_photo(directory, name, size=(4, 3), value=0, extension=".png"):
    width, height = size
    image = np.full((height, width, 3), value, dtype=np.uint8)
    path = directory / f"{name}{extension}"
    path.write_bytes(cv2.imencode(extension, image)[1].tobytes())
    return path


def load(directory, size=(4, 3)):
    return load_still_images(directory, reference_size=size, utc_offset=BANGKOK, now=NOW)


def test_photo_time_comes_from_the_file_name_in_the_given_offset():
    assert photo_time("20260925_0931.jpeg", BANGKOK) == datetime(2026, 9, 25, 2, 31, tzinfo=UTC)
    assert photo_time("20260925_093105_cam.png", BANGKOK) == datetime(2026, 9, 25, 2, 31, 5, tzinfo=UTC)


@pytest.mark.parametrize("name", ["IMG_0001.jpeg", "20260925.jpeg", "20261399_0931.jpeg", "20260925_2561.jpeg"])
def test_photo_without_a_valid_time_in_its_name_is_rejected(name):
    with pytest.raises(StillImageError, match=name):
        photo_time(name, BANGKOK)


def test_photos_load_in_file_name_order_and_skip_hidden_files(tmp_path):
    write_photo(tmp_path, "20260925_1000", value=2)
    write_photo(tmp_path, "20260925_0931", value=1, extension=".jpeg")
    (tmp_path / ".DS_Store").write_bytes(b"not a photo")
    (tmp_path / "nested").mkdir()

    photos = load(tmp_path)

    assert [photo.name for photo in photos] == ["20260925_0931.jpeg", "20260925_1000.png"]
    assert photos[0].captured_at == datetime(2026, 9, 25, 2, 31, tzinfo=UTC)
    assert photos[1].decode().shape == (3, 4, 3)


def test_empty_directory_fails_fast(tmp_path):
    with pytest.raises(StillImageError, match="no photos"):
        load(tmp_path)


def test_missing_directory_fails_fast(tmp_path):
    with pytest.raises(StillImageError, match="not a directory"):
        load(tmp_path / "missing")


def test_unreadable_photo_fails_fast(tmp_path):
    (tmp_path / "20260925_0931.jpeg").write_bytes(b"not an image")

    with pytest.raises(StillImageError, match="cannot be decoded: 20260925_0931.jpeg"):
        load(tmp_path)


def test_photo_with_another_resolution_than_the_calibration_fails_fast(tmp_path):
    write_photo(tmp_path, "20260925_0931")
    write_photo(tmp_path, "20260925_1000", size=(3, 4))

    with pytest.raises(StillImageError, match="20260925_1000.png is 3x4; the calibration reference is 4x3"):
        load(tmp_path)


def test_photo_from_the_future_fails_fast(tmp_path):
    write_photo(tmp_path, "20261015_1600")

    with pytest.raises(StillImageError, match="in the future"):
        load(tmp_path)


class FakeStop:
    """Advances a fake clock on every wait and stops the loop after `waits` waits."""

    def __init__(self, waits):
        self.now = 0.0
        self.waits = waits
        self.durations = []

    def is_set(self):
        return len(self.durations) >= self.waits

    def wait(self, timeout):
        self.durations.append(timeout)
        self.now += timeout
        return self.is_set()


class RecordingSlot(LatestFrameSlot):
    def __init__(self, stop):
        super().__init__()
        self.stop = stop
        self.puts = []

    def put(self, frame):
        self.puts.append((self.stop.now, frame))
        super().put(frame)


def test_loop_holds_each_photo_reputting_it_every_interval_and_restarts(tmp_path):
    write_photo(tmp_path, "20260925_0931", value=1)
    write_photo(tmp_path, "20260925_1000", value=2)
    stop = FakeStop(waits=10)
    slot = RecordingSlot(stop)

    loop = StillImageLoop(load(tmp_path), slot, hold_s=5, interval_s=2, stop=stop, clock=lambda: stop.now)
    loop.run()

    shown = [(at, frame.captured_at, int(frame.image[0, 0, 0])) for at, frame in slot.puts]
    first, second = (datetime(2026, 9, 25, 2, 31, tzinfo=UTC), 1), (datetime(2026, 9, 25, 3, 0, tzinfo=UTC), 2)
    assert shown == [
        (0, *first), (2, *first), (4, *first),
        (5, *second), (7, *second), (9, *second),
        (10, *first), (12, *first), (14, *first),
        (15, *second),
    ]
    assert stop.durations == [2, 2, 1] * 3 + [2]
    assert loop.finished.is_set()
