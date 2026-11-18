"""Identify each motorcycle that rides into the Guard Booth entrance clip for the recorded preview.

The clip is stand-in data configured by the operator. It runs through the operator video pipeline
(sampled frames, ByteTrack, ConvNeXt averaged per track) in the background from API startup, and its
track evidence is cached per clip file and model, because the clip loops on the booth screen. A rider
is a sustained track that moves through the clip and reaches the booth zone; a parked motorcycle in
view is not a rider.
"""

import logging
import math
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Literal

from pydantic import BaseModel

from app.classifier import Prediction
from app.parking_inference_settings import MIN_OBSERVATIONS, MODEL_ID, VIDEO_FORMATS
from app.services import video_classifier
from app.services.motorcycle_reference_sizes import ReferenceSizeRules
from app.services.video_classifier import ClipEvidence, TrackEvidence

logger = logging.getLogger(__name__)

CLIP_PATH_ENV = "PARKMAP_GUARD_BOOTH_CLIP_PATH"
CLIP_ZONE_ENV = "PARKMAP_GUARD_BOOTH_CLIP_ZONE"
CLIP_SAMPLE_FPS = 5
# How long a client waits before asking again while the clip is still being tracked.
CLASSIFICATION_RETRY_S = 5
# Net ground movement, as a fraction of the frame, between a track's first and last sighting.
# Riders in the stand-in clip move 0.4 or more; a parked motorcycle ends within 0.1 of where it started.
MIN_RIDER_TRAVEL = 0.15
CLIP_MEDIA_TYPES = {suffix: media_type for media_type, suffix in VIDEO_FORMATS.items()}

RiderReason = Literal["CLASSIFIED", "UNCERTAIN"]


class GuardBoothReferenceSize(BaseModel):
    width_m: float
    length_m: float


class GuardBoothRider(BaseModel):
    """`family` is set only for a confidently classified rider; `arrival_s` is when it reaches the zone."""

    arrival_s: float
    reason: RiderReason
    family: str | None
    top3: list[Prediction]
    preview_url: str | None
    reference_size: GuardBoothReferenceSize | None


class GuardBoothClassification(BaseModel):
    """Riders in clip order. No rider means no motorcycle rode into the booth zone."""

    model_id: str
    riders: list[GuardBoothRider]


@dataclass(frozen=True)
class BoothZone:
    """Normalized frame rectangle at the booth; a rider is shown when its wheels enter it."""

    left: float
    top: float
    right: float
    bottom: float

    def contains(self, x: float, y: float) -> bool:
        return self.left <= x <= self.right and self.top <= y <= self.bottom


WHOLE_FRAME = BoothZone(0, 0, 1, 1)


@dataclass(frozen=True)
class GuardBoothClip:
    path: Path
    media_type: str
    version: tuple[int, int]
    zone: BoothZone


def parse_zone(raw: str | None) -> BoothZone | None:
    """`left,top,right,bottom` in 0..1; unset means the whole frame and anything else invalid is `None`."""
    if not raw:
        return WHOLE_FRAME
    try:
        left, top, right, bottom = (float(value) for value in raw.split(","))
    except ValueError:
        return None
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        return None
    return BoothZone(left, top, right, bottom)


def configured_clip() -> GuardBoothClip | None:
    raw = os.getenv(CLIP_PATH_ENV)
    if not raw:
        return None
    path = Path(raw)
    media_type = CLIP_MEDIA_TYPES.get(path.suffix.lower())
    if media_type is None or not path.is_file():
        return None
    zone = parse_zone(os.getenv(CLIP_ZONE_ENV))
    if zone is None:
        logger.error("%s must be left,top,right,bottom fractions of the frame", CLIP_ZONE_ENV)
        return None
    stats = path.stat()
    return GuardBoothClip(path=path, media_type=media_type, version=(stats.st_mtime_ns, stats.st_size), zone=zone)


def arrival(track: TrackEvidence, zone: BoothZone) -> float | None:
    """When a sustained, moving track first reaches the zone; `None` when it is not a rider."""
    if track.observations < MIN_OBSERVATIONS:
        return None
    first, last = track.path[0], track.path[-1]
    if math.dist((first.x, first.y), (last.x, last.y)) < MIN_RIDER_TRAVEL:
        return None
    return next((point.time for point in track.path if zone.contains(point.x, point.y)), None)


def summarize(clip: ClipEvidence, zone: BoothZone, rules: ReferenceSizeRules) -> GuardBoothClassification:
    riders = []
    for track_id, track in clip.tracks.items():
        arrival_s = arrival(track, zone)
        if arrival_s is None:
            continue
        summary = track.summary(track_id, clip.classes)
        size = rules.classes.get(summary.family) if summary.family else None
        riders.append(GuardBoothRider(
            arrival_s=arrival_s,
            reason="CLASSIFIED" if summary.family else "UNCERTAIN",
            family=summary.family,
            top3=summary.top3,
            preview_url=summary.preview_url,
            reference_size=GuardBoothReferenceSize(width_m=size.width_m, length_m=size.length_m) if size else None,
        ))
    return GuardBoothClassification(model_id=MODEL_ID, riders=sorted(riders, key=lambda rider: rider.arrival_s))


def _start_thread(run: Callable[[], None]) -> None:
    Thread(target=run, name="guard-booth-clip", daemon=True).start()


class GuardBoothClipClassifier:
    """Tracks the clip in the background, because tracking it on a server CPU takes minutes.

    No request waits for tracking: `evidence` starts it and reports `None` until it is done. The latest
    evidence is kept per clip file and model; a replaced clip file or model is tracked again. A failed
    run is reported once, and the next request tracks the clip again.
    """

    def __init__(self, start: Callable[[Callable[[], None]], None] = _start_thread) -> None:
        self._start = start
        self._lock = Lock()
        self._key: tuple[Path, tuple[int, int], str] | None = None
        self._evidence: ClipEvidence | None = None
        self._error: Exception | None = None

    def evidence(self, clip: GuardBoothClip) -> ClipEvidence | None:
        """The clip's evidence, or `None` while it is tracked. A failed run raises its error."""
        key = (clip.path, clip.version, MODEL_ID)
        with self._lock:
            start = self._key != key
            if start:
                self._key, self._evidence, self._error = key, None, None
        if start:
            self._start(lambda: self._track(clip, key))
        with self._lock:
            if self._key != key:  # Another clip replaced this one meanwhile.
                return None
            if self._error is None:
                return self._evidence
            error, self._key, self._error = self._error, None, None
        raise error

    def _track(self, clip: GuardBoothClip, key: tuple[Path, tuple[int, int], str]) -> None:
        evidence: ClipEvidence | None = None
        error: Exception | None = None
        try:
            # Shares the detector and tracker with the operator video API.
            with video_classifier.VIDEO_LOCK:
                evidence = video_classifier.track_clip(clip.path, MODEL_ID, CLIP_SAMPLE_FPS)
        except Exception as failure:  # A background run has no caller to raise to; the next request reports it.
            logger.exception("Guard Booth clip tracking failed")
            error = failure
        with self._lock:
            if self._key == key:
                self._evidence, self._error = evidence, error
