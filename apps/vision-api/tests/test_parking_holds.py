from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_engine, reset_engine
from app.db.tables import ParkingHold, Site
from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.guard_booth_fitting import GuardBoothFitRequest
from app.services.parking_holds import HoldContext, mask_held_space, reserve, snapshot
from app.services.region_clipping_service import polygon_shape

NOW = datetime(2026, 11, 18, tzinfo=UTC)


def context(at=NOW):
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (10, 0), (10, 2), (5, 2)]]]
    return HoldContext(
        area=ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", observed_at=at, processed_at=at, regions=[
            LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
            LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=5),
        ]),
        entrance=MetricGroundPoint(x_m=21.5, y_m=-21), scale=1, geometry_version="cal-1:lot-1",
    )


def seed():
    with Session(get_engine()) as session:
        session.add(Site(id="sripatum", name="Test", latitude=0, longitude=0))
        session.commit()


def issue(request, channel="GUARD_BOOTH", at=NOW, evidence=None):
    with Session(get_engine()) as session:
        result = reserve(session, "sripatum", request, channel, lambda: evidence or context(at), at)
        session.commit()
        return result


def test_line_and_booth_share_durable_non_overlapping_holds(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request)
    second = issue(request.model_copy(update={"request_id": uuid4()}), "LINE")
    assert first.polygon and second.polygon
    assert polygon_shape(first.polygon).intersection(polygon_shape(second.polygon)).area == 0
    # A new service/session after restart sees the same request and original deadline.
    reset_engine()
    retry = issue(request, at=NOW + timedelta(seconds=20), evidence=context())
    assert retry.polygon == first.polygon
    assert retry.expires_at == first.expires_at == NOW + timedelta(minutes=2)
    assert len(retry.holds) == 2


def test_concurrent_line_and_booth_requests_are_serialized(database):
    seed()
    def arrive(index):
        return issue(GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW), "LINE" if index % 2 else "GUARD_BOOTH")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(arrive, range(4)))
    assert all(result.polygon for result in results)
    for i, result in enumerate(results):
        for other in results[i + 1:]:
            assert polygon_shape(result.polygon).intersection(polygon_shape(other.polygon)).area == 0


def test_concurrent_retries_of_one_request_create_exactly_one_hold(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: issue(request), range(4)))
    assert all(result.polygon == results[0].polygon and len(result.holds) == 1 for result in results)
    assert len(read(context(), NOW)) == 1


def read(evidence, at):
    with Session(get_engine()) as session:
        result = snapshot(session, "sripatum", lambda: evidence, at)
        session.commit()
        return result


def test_deadline_needs_new_empty_evidence_and_keeps_occlusion_blocked(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    issue(request)
    deadline = NOW + timedelta(minutes=2)
    waiting = read(context(), deadline)
    assert len(waiting) == 1 and waiting[0].stage == "AWAITING_CONFIRMATION"
    hidden = context(deadline)
    hidden.area.regions[1].reasons = ["GROUND_MAY_BE_OCCLUDED"]
    assert read(hidden, deadline)[0].stage == "AWAITING_CONFIRMATION"
    stale = context(deadline)
    stale.area.status = "STALE"
    assert read(stale, deadline)[0].stage == "AWAITING_CONFIRMATION"
    assert read(context(deadline), deadline) == []
    # Retrying the old ID cannot create a fresh two-minute reservation.
    retry = issue(request.model_copy(update={"observed_at": deadline}), at=deadline)
    assert retry.polygon is None and retry.stage == "RELEASED"
    with Session(get_engine()) as session:
        hold = session.scalar(select(ParkingHold))
        assert [stage["stage"] for stage in hold.history] == ["HELD", "AWAITING_CONFIRMATION", "RELEASED"]


def test_segment_occupancy_confirms_region_without_identifying_the_rider(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request)
    at = NOW + timedelta(seconds=10)
    occupied = context(at)
    occupied.area.regions.append(LiveRegion(kind="OCCUPIED", polygon=first.polygon))
    assert read(occupied, at)[0].stage == "OCCUPIED_CONFIRMED"
    retry = issue(request.model_copy(update={"observed_at": at}), at=at, evidence=occupied)
    assert retry.polygon is None and retry.stage == "OCCUPIED_CONFIRMED"
    assert read(context(NOW + timedelta(minutes=2)), NOW + timedelta(minutes=2)) == []


def test_preview_scene_releases_only_its_own_holds(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    issue(request.model_copy(update={"ends_with_photo": True}))
    line = issue(request.model_copy(update={"request_id": uuid4()}), "LINE")
    shown = read(context(NOW + timedelta(seconds=10)), NOW + timedelta(seconds=10))
    assert len(shown) == 1 and shown[0].polygon == line.polygon and shown[0].channel == "LINE"


def test_request_id_cannot_be_reused_for_a_different_vehicle_or_channel(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    issue(request)
    for altered, channel in ((request.model_copy(update={"family": "forza"}), "GUARD_BOOTH"), (request, "LINE")):
        with pytest.raises(HTTPException) as error:
            issue(altered, channel)
        assert error.value.status_code == 409


def test_geometry_change_never_releases_or_redirects_an_old_hold(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    issue(request)
    at = NOW + timedelta(minutes=2)
    changed = context(at)
    changed.geometry_version = "cal-2:lot-2"
    assert read(changed, at)[0].stage == "AWAITING_CONFIRMATION"
    assert issue(request.model_copy(update={"observed_at": at}), at=at, evidence=changed).polygon is None


def test_held_frames_are_cut_out_of_green_without_hiding_the_rest_of_the_band(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request)
    with Session(get_engine()) as session:
        shown = mask_held_space(session, "sripatum", context().area)
    green = [polygon_shape(r.polygon) for r in shown.regions if r.kind == "WIDTH_SUFFICIENT"]
    assert green and sum(p.area for p in green) > 5
    assert all(p.intersection(polygon_shape(first.polygon)).area == 0 for p in green)
    assert any(r.reasons == ["RECOMMENDATION_HELD"] for r in shown.regions)


def test_unknown_patch_cannot_clear_a_hold_even_when_a_width_band_overlaps_it(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request)
    at = NOW + timedelta(minutes=2)
    hidden = context(at)
    hidden.area.regions.append(LiveRegion(kind="UNKNOWN", polygon=first.polygon))
    assert read(hidden, at)[0].stage == "AWAITING_CONFIRMATION"
    hidden.area.regions.append(LiveRegion(kind="UNKNOWN", polygon=hidden.area.regions[1].polygon))
    other = issue(request.model_copy(update={"request_id": uuid4(), "observed_at": at}), at=at, evidence=hidden)
    assert other.polygon is None


def test_api_entrypoints_share_a_transactional_ledger(database, monkeypatch):
    """Synthetic calibrated state through ingestion, placement and public endpoints."""
    import json
    from pathlib import Path

    from fastapi.testclient import TestClient

    from app.db.tables import Calibration, LotModel, ParkingArea
    from app.main import app

    data = json.loads((Path(__file__).parents[1] / "migrations/data/0004_sripatum_setup.json").read_text(encoding="utf-8"))
    with Session(get_engine()) as session:
        session.add(Site(**data["site"]))
        session.flush()
        session.add_all(ParkingArea(**a) for a in data["parking_areas"])
        session.flush()
        for cal in data["calibrations"]:
            session.add(Calibration(parking_area_id=cal["parking_area_id"], version=cal["version"],
                                    payload={k: json.loads(v) for k, v in cal["config_files"].items()}, is_active=True))
        session.add(LotModel(site_id="sripatum", version=1, payload=data["lot_model"], is_active=True))
        session.commit()
    monkeypatch.setenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW", "1")
    monkeypatch.setenv("PARKMAP_WORKER_TOKEN", "hold-test")
    now = datetime.now(UTC)
    area = data["parking_areas"][0]
    cal = data["calibrations"][0]
    # Row coordinates are in the saved calibration's metric frame; placement
    # uses exactly the same server transform as the production worker map.
    regions = context(now).area.model_dump(mode="json")["regions"]
    payload = {"parking_area_id": area["id"], "camera_id": area["camera_id"], "source": "STILL_IMAGE_LOOP",
               "observed_at": now.isoformat(), "processed_at": now.isoformat(), "calibration_version": cal["version"],
               "calibration_provenance": "ESTIMATED", "analysis_version": "holds-test", "regions": regions, "motorcycles": []}
    client = TestClient(app)
    assert client.post("/api/internal/parking-states", json=payload, headers={"Authorization": "Bearer hold-test"}).status_code == 204
    body = {"request_id": str(uuid4()), "family": "grand_filano", "observed_at": now.isoformat()}
    booth = client.post("/api/sites/sripatum/guard-booth-fit", json=body)
    assert booth.status_code == 200, booth.text
    assert booth.json()["polygon"], booth.text
    body["request_id"] = str(uuid4())
    line = client.post("/api/sites/sripatum/parking-recommendation", json=body)
    assert line.status_code == 200 and line.json()["polygon"], line.text
    from app.services.guard_booth_fitting import GuardBoothFit
    first, second = GuardBoothFit.model_validate(booth.json()), GuardBoothFit.model_validate(line.json())
    assert polygon_shape(first.polygon).intersection(polygon_shape(second.polygon)).area == 0
    assert {h["channel"] for h in client.get("/api/sites/sripatum/parking-holds").json()} == {"LINE", "GUARD_BOOTH"}
    current = client.get("/api/sites/sripatum/parking-state").json()["areas"][0]
    assert any("RECOMMENDATION_HELD" in r["reasons"] for r in current["regions"])
    # A subsequent Segment observation confirms occupancy in the held region.
    payload["processed_at"] = (now + timedelta(seconds=1)).isoformat()
    payload["regions"].append({"kind": "OCCUPIED", "polygon": regions[1]["polygon"]})
    assert client.post("/api/internal/parking-states", json=payload, headers={"Authorization": "Bearer hold-test"}).status_code == 204
    assert all(h["stage"] == "OCCUPIED_CONFIRMED" for h in client.get("/api/sites/sripatum/parking-holds").json())
