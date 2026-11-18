from shapely.geometry import Polygon, box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.guard_booth_fitting import fit_frames, fit_recorded_preview
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
    assert fit_recorded_preview(state.model_copy(update={"status": "STALE"}), "grand_filano", entrance, scale=1).polygon is None
    band.reasons = ["GROUND_MAY_BE_OCCLUDED"]
    assert fit_recorded_preview(state, "grand_filano", entrance, scale=1).polygon is None


def test_only_width_decides_a_fit_and_a_longer_frame_is_drawn_at_the_band_depth():
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (9, 0), (9, 1.9), (5, 1.9)]]]
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)

    def state(*occupied: tuple[float, float]) -> ParkingAreaLiveState:
        return ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
            LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
            LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=4),
            *(LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=[[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(x0, 0), (x1, 0), (x1, 1.9), (x0, 1.9)]]])
              for x0, x1 in occupied),
        ])

    # Forza (2.171 m long) is longer than the 1.9 m row; its frame stays inside the band.
    long = fit_recorded_preview(state(), "forza", entrance, scale=1)
    assert long.polygon is not None and long.length_m == 2.171
    assert polygon_shape(polygon).covers(polygon_shape(long.polygon))

    # A 0.8 m gap takes Grand Filano (0.685 + 0.05 m) but not Forza (0.772 + 0.05 m).
    gap = state((5, 6), (6.8, 9))
    narrow = fit_recorded_preview(gap, "grand_filano", entrance, scale=1)
    assert narrow.polygon is not None
    assert all(6 <= point.x_m <= 6.8 for point in narrow.polygon[0])
    assert fit_recorded_preview(gap, "forza", entrance, scale=1).polygon is None
