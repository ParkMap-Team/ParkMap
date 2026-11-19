import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.main import app
from app.services import guard_booth_clip
from app.services.guard_booth_clip import (
    WHOLE_FRAME,
    BoothZone,
    GuardBoothClipClassifier,
    arrival,
    configured_clip,
    parse_zone,
    summarize,
)
from app.services.guard_booth_fitting import GuardBoothFitRequest
from app.services.motorcycle_reference_sizes import load_rules
from app.services.video_classifier import ClipEvidence, TrackEvidence, TrackPoint

CLASSES = ["click", "unsized_model", "pcx"]


def track(points: list[tuple[float, float, float]], family: str | None = "click", preview: str = "data:image/jpeg;base64,1") -> TrackEvidence:
    """One observation per `(time, x, y)` ground point; `None` scores evenly so no family is confident."""
    evidence = TrackEvidence(preview_url=preview)
    scores = [0.9 if name == family else 0.05 for name in CLASSES] if family else [1 / len(CLASSES)] * len(CLASSES)
    for time, x, y in points:
        evidence.add(time, scores)
        evidence.path.append(TrackPoint(time=time, x=x, y=y))
    return evidence


def ride(start: float, family: str | None = "click") -> TrackEvidence:
    """A rider moving from the top right to the bottom left over one second."""
    return track([(start + step / 4, 0.9 - step / 5, 0.4 + step / 8) for step in range(5)], family)


def evidence(*tracks: TrackEvidence) -> ClipEvidence:
    return ClipEvidence(sampled_frames=10, classes=CLASSES, tracks=dict(enumerate(tracks, start=1)))


def test_a_rider_is_a_sustained_moving_track_that_reaches_the_zone():
    assert arrival(ride(2.0), WHOLE_FRAME) == 2.0
    assert arrival(track([(0, 0.9, 0.4), (0.5, 0.5, 0.9)]), WHOLE_FRAME) is None  # too few observations
    parked = track([(time, 0.97, 0.65 + (time % 2) / 20) for time in range(8)])
    assert arrival(parked, WHOLE_FRAME) is None
    # The fourth sighting, at x 0.3 and y 0.775, is the first inside the zone.
    assert arrival(ride(2.0), BoothZone(0, 0.5, 0.45, 1)) == 2.75
    assert arrival(ride(2.0), BoothZone(0, 0, 0.1, 0.1)) is None


def test_riders_come_in_arrival_order_with_reference_sizes_for_configured_families():
    rules = load_rules()
    parked = track([(time, 0.97, 0.65) for time in range(8)], "pcx")
    result = summarize(evidence(ride(6.0, "unsized_model"), parked, ride(1.0), ride(9.0, None)), WHOLE_FRAME, rules)
    assert [(rider.arrival_s, rider.reason, rider.family) for rider in result.riders] == [
        (1.0, "CLASSIFIED", "click"), (6.0, "CLASSIFIED", "unsized_model"), (9.0, "UNCERTAIN", None),
    ]
    click, unsized, uncertain = result.riders
    assert click.reference_size is not None
    assert (click.reference_size.width_m, click.reference_size.length_m) == (rules.classes["click"].width_m, rules.classes["click"].length_m)
    assert click.preview_url == "data:image/jpeg;base64,1"
    assert (unsized.reference_size, uncertain.reference_size) == (None, None)
    assert uncertain.top3
    assert summarize(evidence(parked), WHOLE_FRAME, rules).riders == []


@pytest.mark.parametrize(("raw", "zone"), [
    (None, WHOLE_FRAME),
    ("", WHOLE_FRAME),
    ("0.1, 0.5, 0.9, 1", BoothZone(0.1, 0.5, 0.9, 1)),
    ("0.5,0.5,0.4,1", None),
    ("0,0,1,1.2", None),
    ("0,0,1", None),
    ("a,b,c,d", None),
])
def test_booth_zone_is_a_rectangle_inside_the_frame(raw, zone):
    assert parse_zone(raw) == zone


def test_clip_must_be_an_existing_mp4_or_webm(monkeypatch, tmp_path):
    monkeypatch.delenv(guard_booth_clip.CLIP_PATH_ENV, raising=False)
    monkeypatch.delenv(guard_booth_clip.CLIP_ZONE_ENV, raising=False)
    assert configured_clip() is None
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(tmp_path / "missing.mp4"))
    assert configured_clip() is None
    (tmp_path / "clip.mov").write_bytes(b"x")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(tmp_path / "clip.mov"))
    assert configured_clip() is None
    (tmp_path / "clip.WebM").write_bytes(b"x")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(tmp_path / "clip.WebM"))
    assert configured_clip().media_type == "video/webm"
    monkeypatch.setenv(guard_booth_clip.CLIP_ZONE_ENV, "0,0,2,1")
    assert configured_clip() is None


def test_a_clip_is_classified_once_until_the_file_changes(monkeypatch, tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"first")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(path))
    calls = []

    def track_clip(clip_path, model_id, fps, *, max_duration_s):
        calls.append((clip_path, model_id, fps, max_duration_s))
        return evidence(*[ride(0)] * len(calls))

    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", track_clip)
    classifier = GuardBoothClipClassifier(start=run_now)
    first = classifier.evidence(configured_clip())
    assert classifier.evidence(configured_clip()) is first
    assert calls == [
        (path, guard_booth_clip.MODEL_ID, guard_booth_clip.CLIP_SAMPLE_FPS, guard_booth_clip.MAX_CLIP_DURATION_S)
    ]

    path.write_bytes(b"replaced clip")
    os.utime(path, ns=(1, 1))
    assert len(classifier.evidence(configured_clip()).tracks) == 2


def test_no_request_waits_while_the_clip_is_tracked(monkeypatch, tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"clip")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(path))
    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", lambda *_, **__: evidence(ride(0)))
    runs = []
    classifier = GuardBoothClipClassifier(start=runs.append)
    assert classifier.evidence(configured_clip()) is None
    assert classifier.evidence(configured_clip()) is None
    [run] = runs
    run()
    assert len(classifier.evidence(configured_clip()).tracks) == 1
    assert len(runs) == 1


def test_a_failed_run_is_reported_once_and_then_tracked_again(monkeypatch, tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"clip")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(path))
    outcomes = [OSError("disk"), evidence(ride(0))]

    def track_clip(*_, **__):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", track_clip)
    classifier = GuardBoothClipClassifier(start=run_now)
    with pytest.raises(OSError):
        classifier.evidence(configured_clip())
    assert len(classifier.evidence(configured_clip()).tracks) == 1


def run_now(run):
    run()


@pytest.fixture
def booth_clip(monkeypatch, tmp_path):
    path = tmp_path / "entrance.mp4"
    path.write_bytes(bytes(range(256)) * 4)
    monkeypatch.setenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW", "1")
    monkeypatch.setenv(guard_booth_clip.CLIP_PATH_ENV, str(path))
    monkeypatch.delenv(guard_booth_clip.CLIP_ZONE_ENV, raising=False)
    monkeypatch.setattr(main, "_guard_booth_classifier", GuardBoothClipClassifier(start=run_now))
    return path


def test_the_api_starts_tracking_the_clip_when_it_starts(booth_clip, monkeypatch):
    runs = []
    monkeypatch.setattr(main, "_guard_booth_classifier", GuardBoothClipClassifier(start=runs.append))
    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", lambda *_, **__: evidence(ride(3.0)))
    with TestClient(app) as client:
        assert len(runs) == 1
        pending = client.get("/api/sites/sripatum/guard-booth-classification")
        assert (pending.status_code, pending.headers["retry-after"], pending.headers["cache-control"]) == (503, str(guard_booth_clip.CLASSIFICATION_RETRY_S), "no-store")
        runs[0]()
        assert client.get("/api/sites/sripatum/guard-booth-classification").status_code == 200
    assert len(runs) == 1


def test_booth_endpoints_stay_hidden_without_the_preview_flag_or_a_clip(booth_clip, monkeypatch):
    client = TestClient(app)
    for path in ("/api/sites/other/guard-booth-clip", "/api/sites/other/guard-booth-classification"):
        assert client.get(path).status_code == 404
    monkeypatch.setenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW", "0")
    assert client.get("/api/sites/sripatum/guard-booth-clip").status_code == 404
    monkeypatch.setenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW", "1")
    monkeypatch.delenv(guard_booth_clip.CLIP_PATH_ENV)
    assert client.get("/api/sites/sripatum/guard-booth-classification").status_code == 404


def test_booth_clip_supports_range_requests_for_video_playback(booth_clip):
    client = TestClient(app)
    whole = client.get("/api/sites/sripatum/guard-booth-clip")
    assert (whole.status_code, whole.headers["content-type"], whole.content) == (200, "video/mp4", booth_clip.read_bytes())
    part = client.get("/api/sites/sripatum/guard-booth-clip", headers={"Range": "bytes=0-9"})
    assert (part.status_code, part.content, part.headers["content-range"]) == (206, booth_clip.read_bytes()[:10], "bytes 0-9/1024")


def test_booth_classification_reports_each_rider(booth_clip, monkeypatch):
    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", lambda *_, **__: evidence(ride(3.0)))
    response = TestClient(app).get("/api/sites/sripatum/guard-booth-classification")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    [rider] = body["riders"]
    assert (rider["arrival_s"], rider["reason"], rider["family"], rider["reference_size"]["width_m"]) == (3.0, "CLASSIFIED", "click", load_rules().classes["click"].width_m)


@pytest.mark.parametrize("error", [HTTPException(422, "Unreadable video"), HTTPException(503, "Missing checkpoint"), OSError("disk")])
def test_booth_classification_setup_failures_are_unavailable(booth_clip, monkeypatch, error):
    def fail(*_, **__):
        raise error

    monkeypatch.setattr(guard_booth_clip.video_classifier, "track_clip", fail)
    response = TestClient(app).get("/api/sites/sripatum/guard-booth-classification")
    assert response.status_code == 503
    assert "retry-after" not in response.headers


def test_fit_requests_accept_every_family_with_a_reference_size():
    fields = {"request_id": uuid4(), "observed_at": datetime.now(UTC)}
    for family in load_rules().classes:
        assert GuardBoothFitRequest(family=family, **fields).family == family
    with pytest.raises(ValidationError):
        GuardBoothFitRequest(family="unsized_model", **fields)
