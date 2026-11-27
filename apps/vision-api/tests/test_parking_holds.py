import math
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_engine, reset_engine
from app.db.tables import ParkingHold, Site
from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.parking_holds import (
    HoldContext,
    mask_held_space,
    owner_recommendation,
    reserve,
    snapshot,
)
from app.services.recommendation_models import GuardBoothFitRequest
from app.services.region_clipping_service import polygon_shape

NOW = datetime(2026, 11, 18, tzinfo=UTC)


def test_cancellation_endpoint_requires_verified_owner_header(monkeypatch):
    from fastapi.testclient import TestClient

    from app.db.session import get_session
    from app.main import app

    monkeypatch.setenv("PARKMAP_GUARD_BOOTH_FIT_PREVIEW", "1")
    # Authentication rejection must happen before the endpoint uses a database.
    monkeypatch.setitem(app.dependency_overrides, get_session, lambda: None)
    client = TestClient(app)
    for headers in ({}, {"X-Parkmap-Owner": "invalid"}):
        assert client.delete("/api/sites/sripatum/parking-recommendation", headers=headers).status_code == 403


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


def test_line_and_booth_use_independent_clearance_but_keep_one_ledger(database, monkeypatch):
    from app.services import guard_booth_fitting

    monkeypatch.setattr(guard_booth_fitting, "GUARD_BOOTH_CLEARANCE_M", .05)
    seed()
    evidence = context()
    gap = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (5.71, 0), (5.71, 2), (5, 2)]]]
    evidence.area.regions[1].polygon = gap
    evidence.area.regions[1].width_m = .71
    request = GuardBoothFitRequest(request_id=uuid4(), family="scoopy", observed_at=NOW)
    booth = issue(request, evidence=evidence)
    assert booth.polygon is None  # .693 + .05 does not fit
    rider = issue(request.model_copy(update={"request_id": uuid4()}), "LINE", evidence=evidence, owner="a" * 64)
    assert rider.polygon is not None  # .693 without clearance fits
    with Session(get_engine()) as session:
        assert len(list(session.scalars(select(ParkingHold)))) == 1
        recovered = owner_recommendation(session, "sripatum", "a" * 64, lambda: evidence, NOW)
        assert recovered.polygon == rider.polygon  # polling validates with the LINE policy too


def issue(request, channel="GUARD_BOOTH", at=NOW, evidence=None, owner=None):
    with Session(get_engine()) as session:
        result = reserve(session, "sripatum", request, channel, lambda: evidence or context(at), at, owner_key=owner)
        session.commit()
        return result


def test_owner_can_cancel_only_their_line_hold_and_choose_another_family(database):
    from app.services.parking_holds import cancel_owner_recommendation

    seed()
    first = issue(GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW), "LINE", owner="a" * 64)
    with Session(get_engine()) as session:
        cancel_owner_recommendation(session, "sripatum", "b" * 64, NOW)
        assert session.get(ParkingHold, ("sripatum", first.request_id)).stage == "HELD"
        cancel_owner_recommendation(session, "sripatum", "a" * 64, NOW)
        cancel_owner_recommendation(session, "sripatum", "a" * 64, NOW)  # idempotent
        hold = session.get(ParkingHold, ("sripatum", first.request_id))
        assert hold.stage == "RELEASED"
        assert hold.history[-1]["reason"] == "USER_CANCELLED"
        session.commit()
    second = issue(GuardBoothFitRequest(request_id=uuid4(), family="click", observed_at=NOW), "LINE", owner="a" * 64)
    assert second.request_id != first.request_id
    assert second.family == "click"


def test_one_line_account_recovers_one_hold_across_new_requests_and_restart(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request, "LINE", owner="a" * 64)
    reset_engine()
    other = issue(request.model_copy(update={"request_id": uuid4()}), "LINE", owner="a" * 64)
    assert other.request_id == first.request_id and other.expires_at == first.expires_at
    with Session(get_engine()) as session:
        restored = owner_recommendation(session, "sripatum", "a" * 64, lambda: context(), NOW)
        assert restored.request_id == first.request_id
        assert owner_recommendation(session, "sripatum", "b" * 64, lambda: context(), NOW) is None
        session.commit()


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
            # Rotated/clipped slot edges may differ by floating-point residue.
            assert polygon_shape(result.polygon).intersection(polygon_shape(other.polygon)).area <= 1e-8


def test_concurrent_retries_of_one_request_create_exactly_one_hold(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: issue(request), range(4)))
    assert all(result.polygon == results[0].polygon and len(result.holds) == 1 for result in results)
    assert len(read(context(), NOW)) == 1


def test_concurrent_new_ids_for_one_account_reuse_one_hold(database):
    seed()
    def arrive(_):
        return issue(GuardBoothFitRequest(request_id=uuid4(), family="forza", observed_at=NOW), "LINE", owner="a" * 64)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(arrive, range(4)))
    assert len({r.request_id for r in results}) == 1
    assert len(read(context(), NOW)) == 1


def test_status_never_allocates_or_moves_a_point_and_other_accounts_cannot_claim_it(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request, "LINE", owner="a" * 64)
    with pytest.raises(HTTPException) as error:
        issue(request, "LINE", owner="b" * 64)
    assert error.value.status_code == 409
    at = NOW + timedelta(seconds=10)
    changed = context(at)
    changed.area.regions.append(LiveRegion(kind="UNKNOWN", polygon=first.polygon))
    with Session(get_engine()) as session:
        answer = owner_recommendation(session, "sripatum", "a" * 64, lambda: changed, at)
        assert answer.reason == "PLACEMENT_UNAVAILABLE" and answer.polygon is None
        assert answer.expires_at == first.expires_at
        session.commit()
    with Session(get_engine()) as session:
        restored = owner_recommendation(session, "sripatum", "a" * 64, lambda: context(at), at)
        assert restored.polygon == first.polygon
        session.commit()
    deadline = NOW + timedelta(minutes=2)
    with Session(get_engine()) as session:
        released = owner_recommendation(session, "sripatum", "a" * 64, lambda: context(deadline), deadline)
        assert released.stage == "RELEASED" and released.polygon is None
        assert len(list(session.scalars(select(ParkingHold)))) == 1
        session.commit()
    again = issue(request.model_copy(update={"request_id": uuid4()}), "LINE", owner="a" * 64, at=deadline)
    assert again.stage == "HELD" and again.request_id != first.request_id
    assert again.expires_at == deadline + timedelta(minutes=2)


def test_database_enforces_one_active_hold_per_line_account(database):
    seed()
    issue(GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW), "LINE", owner="a" * 64)
    with Session(get_engine()) as session:
        original = session.scalar(select(ParkingHold))
        duplicate = {column.key: getattr(original, column.key) for column in ParkingHold.__table__.columns}
        duplicate["request_id"] = uuid4()
        session.add(ParkingHold(**duplicate))
        with pytest.raises(IntegrityError):
            session.commit()


def read(evidence, at):
    with Session(get_engine()) as session:
        result = snapshot(session, "sripatum", lambda: evidence, at)
        session.commit()
        return result


@pytest.mark.parametrize("channel", ["LINE", "GUARD_BOOTH"])
def test_deadline_releases_the_same_recorded_width_preview_accepted_for_allocation(database, channel):
    seed()
    evidence = context()
    evidence.area.regions[1].reasons = ["FOOTPRINT_NOT_PROVEN", "GROUND_MAY_BE_OCCLUDED"]
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request, channel, evidence=evidence, owner="a" * 64 if channel == "LINE" else None)
    assert first.polygon is not None

    deadline = NOW + timedelta(minutes=2)
    # Reprocessing the same recorded photo is the demo's evidence clock.
    evidence.area.processed_at = deadline
    assert read(evidence, deadline - timedelta(seconds=1))[0].stage == "HELD"
    assert read(evidence, deadline) == []
    with Session(get_engine()) as session:
        shown = mask_held_space(session, "sripatum", evidence.area)
        assert not any("RECOMMENDATION_HELD" in r.reasons for r in shown.regions)
        assert any(r.kind == "WIDTH_SUFFICIENT" and polygon_shape(r.polygon).covers(polygon_shape(first.polygon)) for r in shown.regions)


def test_deadline_needs_new_empty_evidence_and_keeps_unknown_ground_blocked(database):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    issue(request)
    deadline = NOW + timedelta(minutes=2)
    waiting = read(context(), deadline)
    assert len(waiting) == 1 and waiting[0].stage == "AWAITING_CONFIRMATION"
    hidden = context(deadline)
    hidden.area.regions.append(LiveRegion(kind="UNKNOWN", polygon=hidden.area.regions[1].polygon))
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


def tilted_context(at=NOW):
    """A 0.9 m gap between two parked bikes in a row turned 20 degrees, like a camera's row."""
    angle = math.radians(20)

    def along(start, end, depth=1.9):
        corners = [(start, 0), (end, 0), (end, depth), (start, depth)]
        return [[MetricGroundPoint(x_m=5 + x * math.cos(angle) - y * math.sin(angle), y_m=x * math.sin(angle) + y * math.cos(angle)) for x, y in corners]]
    return HoldContext(
        area=ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", observed_at=at, processed_at=at, regions=[
            LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=along(0, 6)),
            LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=along(0.2, 1.0)),
            LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=along(1.0, 1.9), width_m=0.9, reasons=["FOOTPRINT_NOT_PROVEN"]),
            LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=along(1.9, 2.7)),
        ]),
        entrance=MetricGroundPoint(x_m=21.5, y_m=-21), scale=1, geometry_version="cal-1:lot-1",
    )


def test_a_tight_gap_in_a_tilted_row_keeps_its_place_and_frees_it_on_fresh_empty_evidence(database):
    """Floating-point residue in rotated geometry must not drop a held place or keep it held forever."""
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request, evidence=tilted_context())
    assert first.polygon is not None
    retry = issue(request, at=NOW + timedelta(seconds=4), evidence=tilted_context())
    assert retry.polygon == first.polygon and retry.stage == "HELD"
    deadline = NOW + timedelta(minutes=2)
    assert read(tilted_context(deadline), deadline) == []


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


@pytest.mark.parametrize("channel", ["LINE", "GUARD_BOOTH"])
def test_another_fitting_place_cannot_release_the_original_held_place(database, channel):
    seed()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=NOW)
    first = issue(request, channel)
    deadline = NOW + timedelta(minutes=2)
    hidden = context(deadline)
    hidden.area.regions.append(LiveRegion(kind="UNKNOWN", polygon=first.polygon))

    waiting = read(hidden, deadline)
    assert len(waiting) == 1 and waiting[0].stage == "AWAITING_CONFIRMATION"
    other = issue(request.model_copy(update={"request_id": uuid4(), "observed_at": deadline}),
                  channel, at=deadline, evidence=hidden)
    assert other.polygon is not None
    assert polygon_shape(other.polygon).intersection(polygon_shape(first.polygon)).area <= 1e-8


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
    assert client.post("/api/sites/sripatum/parking-recommendation", json=body).status_code == 422
    assert client.get("/api/sites/sripatum/parking-recommendation").status_code == 403
    body["owner_key"] = "a" * 64
    line = client.post("/api/sites/sripatum/parking-recommendation", json=body)
    assert line.status_code == 200 and line.json()["polygon"], line.text
    from app.services.recommendation_models import GuardBoothFit
    first, second = GuardBoothFit.model_validate(booth.json()), GuardBoothFit.model_validate(line.json())
    assert polygon_shape(first.polygon).intersection(polygon_shape(second.polygon)).area == 0
    assert {h["channel"] for h in client.get("/api/sites/sripatum/parking-holds").json()} == {"GUARD_BOOTH"}
    assert {h["channel"] for h in line.json()["holds"]} == {"LINE"}
    restored = client.get("/api/sites/sripatum/parking-recommendation", headers={"X-Parkmap-Owner": "a" * 64})
    assert restored.json()["request_id"] == line.json()["request_id"]
    assert restored.json()["expires_at"] == line.json()["expires_at"]
    assert client.get("/api/sites/sripatum/parking-recommendation", headers={"X-Parkmap-Owner": "b" * 64}).json() is None
    current = client.get("/api/sites/sripatum/parking-state").json()["areas"][0]
    assert any("RECOMMENDATION_HELD" in r["reasons"] for r in current["regions"])
    # A rider's map shows only ground where its model fits, never the held places.
    rider = client.get("/api/sites/sripatum/parking-state", params={"family": "grand_filano"})
    assert rider.status_code == 200, rider.text
    green = [polygon_shape(LiveRegion.model_validate(r).polygon) for r in rider.json()["areas"][0]["regions"] if r["kind"] == "WIDTH_SUFFICIENT"]
    assert green and all(p.intersection(polygon_shape(first.polygon)).area <= 1e-8 for p in green)
    assert client.get("/api/sites/sripatum/parking-state", params={"family": "not-a-model"}).status_code == 422
    # A subsequent Segment observation confirms occupancy in the held region.
    payload["processed_at"] = (now + timedelta(seconds=1)).isoformat()
    payload["regions"].append({"kind": "OCCUPIED", "polygon": regions[1]["polygon"]})
    assert client.post("/api/internal/parking-states", json=payload, headers={"Authorization": "Bearer hold-test"}).status_code == 204
    assert all(h["stage"] == "OCCUPIED_CONFIRMED" for h in client.get("/api/sites/sripatum/parking-holds").json())
