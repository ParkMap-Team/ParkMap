from datetime import UTC, datetime, timedelta
from uuid import uuid4

from shapely.geometry import Polygon, box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.guard_booth_fitting import GuardBoothFitRequest, RecordedPreviewHolds, fit_frames, fit_recorded_preview
from app.services.region_clipping_service import polygon_shape


def test_vehicle_dimensions_change_which_part_of_a_continuous_band_can_fit():
    shallow = box(0, 0, 4, 2.05)
    deep = box(4, 0, 8, 2.5)
    band = shallow.union(deep)
    small = fit_frames(band, 0.7, 1.9, 0)
    large = fit_frames(band, 0.8, 2.2, 0)

    assert any(frame.centroid.x < 4 for frame in small)
    assert large and all(frame.bounds[0] >= 4 for frame in large)
    assert all(band.covers(frame) for frame in (*small, *large))
    assert not fit_frames(shallow, 0.8, 2.2, 0)


def test_frames_avoid_occupied_or_held_holes_in_the_band():
    blocked = box(1.5, 0.7, 3, 1.4)
    free = box(0, 0, 5, 2.3).difference(blocked)
    frames = fit_frames(free, 0.7, 1.9, 0)
    assert frames
    assert all(free.covers(frame) and frame.intersection(blocked).area == 0 for frame in frames)


def test_a_tight_frame_can_fit_between_the_extremes_of_a_sloping_band():
    band = Polygon([(0, 0), (4, 0.025), (4, 2.05), (0, 2.075)])
    assert any(band.covers(frame) for frame in fit_frames(band, 0.7, 2.035, 0))


def test_recorded_preview_routes_a_small_frame_and_excludes_occluded_bands():
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (9, 0), (9, 2), (5, 2)]]]
    band = LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=4)
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
        band,
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    small = fit_recorded_preview(state, "grand_filano", entrance, scale=1)
    assert small.polygon is not None
    assert small.route[0] == entrance
    assert small.route[-3].x_m > small.route[-2].x_m
    assert small.route[-3].y_m == small.route[-2].y_m == 3.2
    assert fit_recorded_preview(state, "forza", entrance, scale=1).polygon is None
    assert fit_recorded_preview(state.model_copy(update={"status": "STALE"}), "grand_filano", entrance, scale=1).polygon is None
    band.reasons = ["GROUND_MAY_BE_OCCLUDED"]
    assert fit_recorded_preview(state, "grand_filano", entrance, scale=1).polygon is None


def test_two_riders_in_one_band_get_non_overlapping_holds_until_timeout():
    now = datetime(2026, 11, 16, tzinfo=UTC)
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (9, 0), (9, 2), (5, 2)]]]
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", observed_at=now, regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=4),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    holds = RecordedPreviewHolds()
    first_request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=now)
    first = holds.reserve(state, first_request, entrance, 1, now)
    assert first.polygon and first.expires_at == now + timedelta(minutes=2)
    second_at = now + timedelta(seconds=10)
    retry = holds.reserve(state, first_request, entrance, 1, second_at)
    assert retry.polygon == first.polygon and retry.expires_at == first.expires_at
    next_state = state.model_copy(update={"observed_at": second_at})
    stale = holds.reserve(next_state, first_request, entrance, 1, second_at)
    assert stale.observed_at is None and stale.polygon is None
    next_request = first_request.model_copy(update={"observed_at": second_at})
    rechecked = holds.reserve(next_state, next_request, entrance, 1, second_at)
    assert rechecked.polygon == first.polygon and rechecked.expires_at == first.expires_at
    assert rechecked.observed_at == second_at and len(rechecked.holds) == 1
    second = holds.reserve(next_state, next_request.model_copy(update={"request_id": uuid4()}), entrance, 1, second_at)
    assert second.polygon and second.polygon != first.polygon
    assert polygon_shape(first.polygon).intersection(polygon_shape(second.polygon)).area == 0
    assert len(second.holds) == 2
    after_expiry = holds.reserve(state, first_request.model_copy(update={"request_id": uuid4()}), entrance, 1, now + timedelta(minutes=2))
    assert after_expiry.polygon == first.polygon


def test_moving_the_recommendation_keeps_the_old_point_reserved_until_expiry():
    now = datetime(2026, 11, 16, tzinfo=UTC)
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (9, 0), (9, 2), (5, 2)]]]
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", observed_at=now, regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=4),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    holds = RecordedPreviewHolds()
    request = GuardBoothFitRequest(request_id=uuid4(), family="grand_filano", observed_at=now)
    first = holds.reserve(state, request, entrance, 1, now)
    assert first.polygon is not None

    next_at = now + timedelta(seconds=10)
    occupied = LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=first.polygon)
    next_state = state.model_copy(update={"observed_at": next_at, "regions": [*state.regions, occupied]})
    next_request = request.model_copy(update={"observed_at": next_at})
    replacement = holds.reserve(next_state, next_request, entrance, 1, next_at)
    assert replacement.polygon is not None and replacement.polygon != first.polygon
    assert replacement.expires_at == first.expires_at
    assert {hold.expires_at for hold in replacement.holds} == {first.expires_at}
    assert any(hold.polygon == first.polygon for hold in replacement.holds)

    following_at = now + timedelta(seconds=20)
    following_state = state.model_copy(update={"observed_at": following_at})
    other_request = request.model_copy(update={"request_id": uuid4(), "observed_at": following_at})
    other = holds.reserve(following_state, other_request, entrance, 1, following_at)
    assert other.polygon is not None
    assert polygon_shape(other.polygon).intersection(polygon_shape(first.polygon)).area == 0
