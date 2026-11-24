
from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.guard_booth_fitting import (
    fit_recorded_preview,
)
from app.services.region_clipping_service import polygon_shape
from app.services.rider_map_fitting import free_ground_for


def test_recorded_preview_uses_width_despite_occlusion_flag_but_keeps_stale_and_hold_gates():
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
    assert fit_recorded_preview(state, "grand_filano", entrance, scale=1).polygon is not None
    free = [r for r in free_ground_for(state, "grand_filano", scale=1).regions if r.kind == "WIDTH_SUFFICIENT"]
    assert free and "GROUND_MAY_BE_OCCLUDED" in free[0].reasons
    assert not any(r.kind == "WIDTH_SUFFICIENT" for r in free_ground_for(state, "grand_filano", scale=1, blocked=[polygon]).regions)
    band.reasons = ["CALIBRATION_UNAVAILABLE"]
    assert fit_recorded_preview(state, "grand_filano", entrance, scale=1).polygon is None


def test_default_guard_booth_width_adds_no_clearance():
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(5, 0), (5.71, 0), (5.71, 1.9), (5, 1.9)]]]
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=polygon),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=polygon, width_m=.71),
    ])
    # Scoopy's .693 m reference fits .71 m only when no .05 m margin is added.
    assert fit_recorded_preview(state, "scoopy", MetricGroundPoint(x_m=21.5, y_m=-21), scale=1).polygon is not None


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

    # With zero clearance, a 0.8 m gap takes Grand Filano (.685 m) and Forza (.772 m).
    gap = state((5, 6), (6.8, 9))
    narrow = fit_recorded_preview(gap, "grand_filano", entrance, scale=1)
    assert narrow.polygon is not None
    assert all(6 - 1e-9 <= point.x_m <= 6.8 + 1e-9 for point in narrow.polygon[0])
    assert fit_recorded_preview(gap, "forza", entrance, scale=1).polygon is not None
    assert fit_recorded_preview(gap, "hd_road_glide", entrance, scale=1).polygon is None


def test_a_riders_free_ground_includes_unrouted_rows_but_still_requires_model_width():
    def rect(x0, x1, y0=0.0, y1=1.9):
        return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]]

    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=rect(5, 35)),
        LiveRegion(kind="UNKNOWN", row_id="row_1", polygon=rect(5, 35, 20, 21.9)),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=rect(5, 6)),
        # No rider clearance: 0.8 m takes Grand Filano and Forza, not Road Glide (.945 m).
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=rect(6, 6.8), width_m=0.8, reasons=["FOOTPRINT_NOT_PROVEN"]),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=rect(6.8, 10)),
        # Wide, but past the right-hand access the guide routes through.
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=rect(30, 34), width_m=4, reasons=["FOOTPRINT_NOT_PROVEN"]),
        # Row E can receive a booth pin without a navigation route.
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_1", polygon=rect(10, 14, 20, 21.9), width_m=4, reasons=["FOOTPRINT_NOT_PROVEN"]),
        LiveRegion(kind="AVAILABLE", row_id="row_5", polygon=rect(12, 14)),
    ])

    def free(area: ParkingAreaLiveState) -> list[LiveRegion]:
        return [r for r in area.regions if r.kind in ("AVAILABLE", "WIDTH_SUFFICIENT")]

    small = free_ground_for(state, "grand_filano", scale=1)
    from app.services.parking_holds import rider_free_ground
    assert [r.row_id for r in free(rider_free_ground(state, "grand_filano", scale=1))] == ["row_5", "row_5", "row_1"]
    assert [r.row_id for r in free(small)] == ["row_5", "row_5", "row_1"]
    assert polygon_shape(free(small)[0].polygon).equals(polygon_shape(state.regions[3].polygon))
    large = free_ground_for(state, "hd_road_glide", scale=1)
    assert [r.row_id for r in free(large)] == ["row_5", "row_1"]
    unrouted = state.model_copy(update={"regions": [r for r in state.regions if r.row_id == "row_1"]})
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    booth = fit_recorded_preview(unrouted, "grand_filano", entrance, scale=1)
    assert booth.polygon is not None and booth.route == []
    assert polygon_shape(unrouted.regions[1].polygon).covers(polygon_shape(booth.polygon))
    assert fit_recorded_preview(state, "grand_filano", entrance, scale=1).route
    assert fit_recorded_preview(unrouted, "grand_filano", entrance, scale=1, blocked=[unrouted.regions[1].polygon]).polygon is None
    from app.services.rider_recommendation import fit_recorded_preview as fit_line
    assert fit_line(unrouted, "grand_filano", entrance, scale=1).polygon is None
    # The occupied rows and row outlines are never touched.
    assert [r for r in small.regions if r not in free(small)] == [r for r in state.regions if r not in free(state)]
    # Live or stale states keep exactly what the backend reported.
    live = state.model_copy(update={"status": "LIVE", "source": "LIVE_CAMERA"})
    assert free_ground_for(live, "forza", scale=1) is live


def test_booth_can_pick_row_e_even_when_another_row_fits():
    def band(row_id, x, y):
        polygon = [[MetricGroundPoint(x_m=px, y_m=py) for px, py in [(x, y), (x + 2, y), (x + 2, y + 1.9), (x, y + 1.9)]]]
        return [LiveRegion(kind="UNKNOWN", row_id=row_id, polygon=polygon),
                LiveRegion(kind="WIDTH_SUFFICIENT", row_id=row_id, polygon=polygon, width_m=2)]

    area = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP",
                                regions=[*band("row_5", 5, 0), *band("row_1", 24, 12)])
    fit = fit_recorded_preview(area, "grand_filano", MetricGroundPoint(x_m=21.5, y_m=-21), scale=1)
    assert fit.polygon is not None and fit.route == []
    assert polygon_shape(area.regions[3].polygon).covers(polygon_shape(fit.polygon))



def test_length_never_decides_a_fit_in_a_row_that_narrows():
    def ring(*points: tuple[float, float]):
        return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in points]]

    row = ring((5, 0), (15, 0), (15, 1.85), (5, 1.95))
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=row),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=row, width_m=10, reasons=["FOOTPRINT_NOT_PROVEN"]),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=ring((5, 0), (10, 0), (10, 2), (5, 2))),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=ring((10.8, 0), (15, 0), (15, 2), (10.8, 2))),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)

    # The 0.8 m gap is shallower than the row's mean depth. Click (0.679 m wide, 1.92 m long) and
    # Grand Filano (0.685 m, 1.82 m) and Forza (.772 m wide) fit without extra clearance.
    for family in ("click", "grand_filano"):
        fit = fit_recorded_preview(state, family, entrance, scale=1)
        assert fit.polygon is not None and all(10 <= point.x_m <= 10.8 for point in fit.polygon[0])
        assert any(r.kind == "WIDTH_SUFFICIENT" for r in free_ground_for(state, family, scale=1).regions)
    assert fit_recorded_preview(state, "forza", entrance, scale=1).polygon is not None
    assert fit_recorded_preview(state, "hd_road_glide", entrance, scale=1).polygon is None
    # Both the rider map and Guard Booth use zero clearance by default.
    assert any(r.kind == "WIDTH_SUFFICIENT" for r in free_ground_for(state, "forza", scale=1).regions)
    assert not any(r.kind == "WIDTH_SUFFICIENT" for r in free_ground_for(state, "hd_road_glide", scale=1).regions)


def test_a_neighbouring_rows_motorcycle_reaching_into_shared_ground_does_not_block_a_slot():
    def rect(x0, x1, y0, y1):
        return [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]]

    # The two row outlines overlap by 0.02 m, as calibrated outlines do.
    state = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=rect(5, 15, 0, 2.5)),
        LiveRegion(kind="UNKNOWN", row_id="row_4", polygon=rect(5, 15, 2.48, 5)),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=rect(5, 10, 0, 2.5)),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=rect(10, 10.8, 0, 2.5), width_m=0.8, reasons=["FOOTPRINT_NOT_PROVEN"]),
        LiveRegion(kind="OCCUPIED", row_id="row_5", polygon=rect(10.8, 15, 0, 2.5)),
        LiveRegion(kind="OCCUPIED", row_id="row_4", polygon=rect(9.5, 11, 2.48, 5)),
    ])
    fit = fit_recorded_preview(state, "grand_filano", MetricGroundPoint(x_m=21.5, y_m=-21), scale=1)
    assert fit.polygon is not None
    assert polygon_shape(fit.polygon).bounds[3] == 2.48
    assert any(r.kind == "WIDTH_SUFFICIENT" for r in free_ground_for(state, "grand_filano", scale=1).regions)
