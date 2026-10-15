"""Parking worker: camera, recorded video, or a photo directory -> YOLO -> parking analysis -> API.

    python -m app.worker --parking-area-id <id> --source rtsp://... | path/to/video.mp4 | path/to/photos/

A photo directory is a still-image loop demo: photos named YYYYMMDD_HHMM[SS] in local time
(--photo-utc-offset), at the calibration reference resolution, each held for --hold-s and looped.

Requires PARKMAP_API_URL and PARKMAP_WORKER_TOKEN. Uses the calibration files in config/.
"""

import argparse
import logging
import os
import signal
import sys
import threading
import time
from datetime import UTC, datetime, timezone
from pathlib import Path

import cv2
import httpx
from dotenv import load_dotenv

from pydantic import ValidationError

from app.models import ParkingCalibration, ParkingStatePublish, StateSourceKind
from app.services.cv_service import ModelUnavailableError, cv_service
from app.services.live_state_service import CalibrationFilesUnavailableError, build_state_publish, calibration_identity
from app.services.parking_analysis_service import ParkingCalibrationUnavailableError, parking_analysis_service
from app.worker.frames import Frame, FrameGrabber, LatestFrameSlot
from app.worker.publisher import StatePublisher
from app.worker.still_images import StillImageError, StillImageLoop, load_still_images

logger = logging.getLogger("app.worker")
CONFIG_DIRECTORY = Path(__file__).resolve().parents[2] / "config"
FATAL_ERRORS = (ModelUnavailableError, CalibrationFilesUnavailableError, ParkingCalibrationUnavailableError)


def source_kind(source: str) -> StateSourceKind:
    if source.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        return "LIVE_CAMERA"
    if Path(source).is_file():
        return "RECORDED_REPLAY"
    if Path(source).is_dir():
        return "STILL_IMAGE_LOOP"
    raise ValueError("Source must be an rtsp/http camera URL, an existing video file, or a photo directory.")


def utc_offset(value: str) -> timezone:
    try:
        offset = datetime.strptime(value, "%z").utcoffset()
    except ValueError as error:
        raise argparse.ArgumentTypeError("use a UTC offset such as +07:00") from error
    assert offset is not None
    return timezone(offset)


def reference_size(config_directory: Path) -> tuple[int, int]:
    """Resolution of the calibration reference photo; still images must match it."""
    path = config_directory / "parking_calibration.json"
    try:
        reference = ParkingCalibration.model_validate_json(path.read_bytes()).reference_image
    except (OSError, ValidationError) as error:
        raise CalibrationFilesUnavailableError("Calibration file is unavailable or invalid: parking_calibration.json") from error
    return reference.width, reference.height


def analyze_frame(frame: Frame, *, parking_area_id: str, source: StateSourceKind) -> ParkingStatePublish:
    version, provenance = calibration_identity(CONFIG_DIRECTORY)
    encoded, jpeg = cv2.imencode(".jpg", frame.image)
    if not encoded:
        raise ValueError("Frame could not be encoded.")
    detection = cv_service.analyze_image(jpeg.tobytes())
    analysis = parking_analysis_service.analyze(detection)
    return build_state_publish(
        analysis,
        parking_area_id=parking_area_id,
        source=source,
        observed_at=frame.captured_at,
        processed_at=datetime.now(UTC),
        calibration_version=version,
        calibration_provenance=provenance,
    )


def positive_seconds(value: str) -> float:
    seconds = float(value)
    if not seconds > 0:
        raise argparse.ArgumentTypeError("must be a positive number of seconds")
    return seconds


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
    grabber: FrameGrabber | StillImageLoop
    if kind == "STILL_IMAGE_LOOP":
        if args.min_interval_s <= 0:
            logger.error("A still-image loop re-shows each photo every --min-interval-s, so it must be positive.")
            return 2
        try:
            photos = load_still_images(Path(args.source), reference_size=reference_size(CONFIG_DIRECTORY), utc_offset=args.photo_utc_offset, now=datetime.now(UTC))
        except (StillImageError, CalibrationFilesUnavailableError) as error:
            logger.error("Still-image loop cannot start: %s", error)
            return 2
        grabber = StillImageLoop(photos, slot, hold_s=args.hold_s, interval_s=args.min_interval_s, stop=stop)
    else:
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
    parser.add_argument("--source", required=True, help="rtsp/http camera URL, a recorded video file, or a photo directory")
    parser.add_argument("--min-interval-s", type=float, default=2.0, help="minimum seconds between analyses")
    parser.add_argument("--hold-s", type=positive_seconds, default=10.0, help="seconds each photo of a still-image loop is shown")
    parser.add_argument("--photo-utc-offset", type=utc_offset, default=utc_offset("+07:00"), help="UTC offset of the local times in photo names")
    sys.exit(run(parser.parse_args()))


if __name__ == "__main__":
    main()
