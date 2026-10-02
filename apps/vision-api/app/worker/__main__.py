"""Parking worker: camera or recorded video -> YOLO -> parking analysis -> API.

    python -m app.worker --parking-area-id <id> --source rtsp://... | path/to/video.mp4

Requires PARKMAP_API_URL and PARKMAP_WORKER_TOKEN. Uses the calibration files in config/.
"""

import argparse
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path

import cv2
import httpx
from dotenv import load_dotenv

from app.models import ParkingStatePublish, StateSourceKind
from app.services.cv_service import ModelUnavailableError, cv_service
from app.services.live_state_service import CalibrationFilesUnavailableError, build_state_publish, calibration_version
from app.services.parking_analysis_service import ParkingCalibrationUnavailableError, parking_analysis_service
from app.worker.frames import Frame, FrameGrabber, LatestFrameSlot
from app.worker.publisher import StatePublisher

logger = logging.getLogger("app.worker")
CONFIG_DIRECTORY = Path(__file__).resolve().parents[2] / "config"
FATAL_ERRORS = (ModelUnavailableError, CalibrationFilesUnavailableError, ParkingCalibrationUnavailableError)


def source_kind(source: str) -> StateSourceKind:
    if source.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        return "LIVE_CAMERA"
    if Path(source).is_file():
        return "RECORDED_REPLAY"
    raise ValueError("Source must be an rtsp/http camera URL or an existing video file.")


def analyze_frame(frame: Frame, *, parking_area_id: str, source: StateSourceKind) -> ParkingStatePublish:
    version = calibration_version(CONFIG_DIRECTORY)
    encoded, jpeg = cv2.imencode(".jpg", frame.image)
    if not encoded:
        raise ValueError("Frame could not be encoded.")
    detection = cv_service.analyze_image(jpeg.tobytes())
    analysis = parking_analysis_service.analyze(detection)
    analysis["analysis_version"] = cv_service.published_analysis_version(analysis["analysis_version"])
    return build_state_publish(analysis, parking_area_id=parking_area_id, source=source, observed_at=frame.captured_at, calibration_version=version)


def run(args: argparse.Namespace) -> int:
    api_url = os.getenv("PARKMAP_API_URL", "")
    token = os.getenv("PARKMAP_WORKER_TOKEN", "")
    if not api_url or not token:
        logger.error("PARKMAP_API_URL and PARKMAP_WORKER_TOKEN are required.")
        return 2
    kind = source_kind(args.source)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    slot = LatestFrameSlot()
    grabber = FrameGrabber(args.source, slot, recorded=kind == "RECORDED_REPLAY", stop=stop)
    publisher = StatePublisher(api_url, token)
    grabber.start()
    try:
        while not stop.is_set():
            frame = slot.take()
            if frame is None:
                if grabber.finished.is_set():
                    break
                stop.wait(0.05)
                continue
            started = time.monotonic()
            try:
                publisher.publish(analyze_frame(frame, parking_area_id=args.parking_area_id, source=kind))
                logger.info("Published state observed at %s (dropped frames so far: %d)", frame.captured_at.isoformat(), slot.dropped)
            except FATAL_ERRORS as error:
                logger.error("Worker cannot analyze frames: %s", error)
                return 1
            except (httpx.HTTPError, ValueError) as error:
                logger.warning("Frame skipped: %s", error)
            stop.wait(max(0.0, args.min_interval_s - (time.monotonic() - started)))
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        publisher.close()
        grabber.join(timeout=5)
    return 0


def main() -> None:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(prog="python -m app.worker", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--parking-area-id", required=True)
    parser.add_argument("--source", required=True, help="rtsp/http camera URL or a recorded video file")
    parser.add_argument("--min-interval-s", type=float, default=2.0, help="minimum seconds between analyses")
    sys.exit(run(parser.parse_args()))


if __name__ == "__main__":
    main()
