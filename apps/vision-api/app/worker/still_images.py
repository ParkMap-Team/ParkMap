"""Still-image loop: a demo source that replays recorded photos from one camera viewpoint.

Each photo is named after its local capture time (`YYYYMMDD_HHMM[SS]...`). Its `captured_at` stays
that real observation time; only the worker's processing time is current.
"""

import logging
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, tzinfo
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from app.worker.frames import Frame, LatestFrameSlot

logger = logging.getLogger(__name__)
PHOTO_NAME = re.compile(r"(\d{8}_\d{4}(?:\d{2})?)(?!\d)")


class StillImageError(ValueError):
    """The photo directory cannot be used as a still-image loop."""


class Stop(Protocol):
    def is_set(self) -> bool: ...

    def wait(self, timeout: float) -> bool: ...


@dataclass(frozen=True)
class StillImage:
    name: str
    captured_at: datetime
    encoded: bytes

    def decode(self) -> np.ndarray:
        # Photos are kept encoded: a decoded 4032x3024 photo takes about 36 MB.
        return cv2.imdecode(np.frombuffer(self.encoded, dtype=np.uint8), cv2.IMREAD_COLOR)


def photo_time(name: str, utc_offset: tzinfo) -> datetime:
    match = PHOTO_NAME.match(name)
    if match is None:
        raise StillImageError(f"Photo name must start with its capture time as YYYYMMDD_HHMM[SS]: {name}")
    stamp = match.group(1)
    try:
        return datetime.strptime(stamp, "%Y%m%d_%H%M%S" if len(stamp) == 15 else "%Y%m%d_%H%M").replace(tzinfo=utc_offset)
    except ValueError as error:
        raise StillImageError(f"Photo name has an invalid capture time: {name}") from error


def load_still_images(directory: Path, *, reference_size: tuple[int, int], utc_offset: tzinfo, now: datetime) -> list[StillImage]:
    """Load every photo in file-name order, failing fast on anything the calibration cannot describe."""
    if not directory.is_dir():
        raise StillImageError(f"Still-image source is not a directory: {directory}")
    paths = sorted(path for path in directory.iterdir() if path.is_file() and not path.name.startswith("."))
    if not paths:
        raise StillImageError(f"Still-image source has no photos: {directory}")
    width, height = reference_size
    photos = []
    for path in paths:
        captured_at = photo_time(path.name, utc_offset)
        if captured_at > now:
            raise StillImageError(f"Photo capture time is in the future: {path.name}")
        photo = StillImage(name=path.name, captured_at=captured_at, encoded=path.read_bytes())
        image = photo.decode()
        if image is None:
            raise StillImageError(f"Photo cannot be decoded: {path.name}")
        if image.shape[:2] != (height, width):
            raise StillImageError(f"Photo {path.name} is {image.shape[1]}x{image.shape[0]}; the calibration reference is {width}x{height}.")
        photos.append(photo)
    return photos


class StillImageLoop(threading.Thread):
    """Shows each photo for `hold_s`, re-putting it every `interval_s` so it is analysed again, and loops forever."""

    def __init__(
        self,
        photos: list[StillImage],
        slot: LatestFrameSlot,
        *,
        hold_s: float,
        interval_s: float,
        stop: Stop,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(name="still-image-loop", daemon=True)
        self.photos = photos
        self.slot = slot
        self.hold_s = hold_s
        self.interval_s = interval_s
        self.stop = stop
        self.clock = clock
        self.finished = threading.Event()

    def run(self) -> None:
        try:
            self._run()
        finally:
            self.finished.set()

    def _run(self) -> None:
        index = 0
        while not self.stop.is_set():
            photo = self.photos[index]
            frame = Frame(image=photo.decode(), captured_at=photo.captured_at)
            logger.info("Showing photo %s", photo.name)
            hold_until = self.clock() + self.hold_s
            while not self.stop.is_set() and (remaining := hold_until - self.clock()) > 0:
                self.slot.put(frame)
                self.stop.wait(min(self.interval_s, remaining))
            index = (index + 1) % len(self.photos)
