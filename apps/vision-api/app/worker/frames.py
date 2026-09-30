import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime

import cv2
import numpy as np

logger = logging.getLogger(__name__)
MAX_RECONNECT_DELAY_S = 30.0


@dataclass(frozen=True)
class Frame:
    image: np.ndarray
    captured_at: datetime


class LatestFrameSlot:
    """Holds only the newest frame. A frame replaced before inference takes it is dropped."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: Frame | None = None
        self.dropped = 0

    def put(self, frame: Frame) -> None:
        with self._lock:
            if self._frame is not None:
                self.dropped += 1
            self._frame = frame

    def take(self) -> Frame | None:
        with self._lock:
            frame, self._frame = self._frame, None
            return frame


class FrameGrabber(threading.Thread):
    """Reads a camera stream or a recorded file into a LatestFrameSlot.

    Streams reconnect with backoff. Recorded files play once at their native frame rate so
    the worker sees the same frame dropping it would see from a live camera. `captured_at`
    is the read time; RTSP buffering can make it later than the true capture time.
    """

    def __init__(self, source: str, slot: LatestFrameSlot, *, recorded: bool, stop: threading.Event) -> None:
        super().__init__(name="frame-grabber", daemon=True)
        self.source = source
        self.slot = slot
        self.recorded = recorded
        self.stop = stop
        self.finished = threading.Event()

    def run(self) -> None:
        try:
            self._run()
        finally:
            self.finished.set()

    def _run(self) -> None:
        delay = 1.0
        while not self.stop.is_set():
            capture = cv2.VideoCapture(self.source)
            if not capture.isOpened():
                capture.release()
                if self.recorded:
                    logger.error("Recorded source could not be opened: %s", self.source)
                    return
                logger.warning("Camera stream unavailable; retrying in %.0fs", delay)
                self.stop.wait(delay)
                delay = min(delay * 2, MAX_RECONNECT_DELAY_S)
                continue
            delay = 1.0
            fps = capture.get(cv2.CAP_PROP_FPS)
            frame_delay = 1.0 / fps if self.recorded and fps > 0 else 0.0
            try:
                while not self.stop.is_set():
                    ok, image = capture.read()
                    if not ok:
                        break
                    self.slot.put(Frame(image=image, captured_at=datetime.now(UTC)))
                    if frame_delay:
                        self.stop.wait(frame_delay)
            finally:
                capture.release()
            if self.recorded:
                logger.info("Recorded source finished.")
                return
            logger.warning("Camera stream ended; reconnecting.")
