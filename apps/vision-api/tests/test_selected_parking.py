import pytest
from shapely.geometry import Point, box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.parking_analysis_service import _geometry
from app.services.region_clipping_service import polygon_shape
from app.services.rider_recommendation import fit_recorded_preview


def area():
    def region(kind, shape):
        return LiveRegion(kind=kind, row_id="row_5", polygon=_geometry(shape)["polygons"][0],
                          width_m=shape.bounds[2]-shape.bounds[0] if kind == "WIDTH_SUFFICIENT" else None)
    return ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        region("UNKNOWN", box(5, 0, 20, 2)),
        region("WIDTH_SUFFICIENT", box(5, 0, 8, 2)),
        region("WIDTH_SUFFICIENT", box(15, 0, 19, 2)),
    ])


@pytest.mark.parametrize("x", [5.01, 6.5, 17.0, 18.99])
def test_selected_point_is_inside_held_frame_and_route_ends_there(x):
    target = MetricGroundPoint(x_m=x, y_m=1)
    result = fit_recorded_preview(area(), "click", MetricGroundPoint(x_m=21.5, y_m=-21), 1, target=target)
    assert result.polygon is not None
    frame = polygon_shape(result.polygon)
    assert frame.covers(Point(x, 1))
    assert (result.route[-1].x_m, result.route[-1].y_m) == pytest.approx(frame.centroid.coords[0])


@pytest.mark.parametrize("x", [4, 10, 21])
def test_invalid_selected_place_does_not_fall_back_to_another_green_place(x):
    result = fit_recorded_preview(area(), "click", MetricGroundPoint(x_m=21.5, y_m=-21), 1,
                                  target=MetricGroundPoint(x_m=x, y_m=1))
    assert result.polygon is None
    assert result.route == []


def test_another_hold_at_selected_place_prevents_booking_it():
    blocked = area().regions[1].polygon
    result = fit_recorded_preview(area(), "click", MetricGroundPoint(x_m=21.5, y_m=-21), 1,
                                  blocked=[blocked], target=MetricGroundPoint(x_m=6.5, y_m=1))
    assert result.polygon is None


@pytest.mark.parametrize("status", ["STALE", "NO_DATA", "LIVE"])
def test_selected_point_does_not_bypass_the_recorded_preview_policy(status):
    state = area().model_copy(update={"status": status})
    assert fit_recorded_preview(state, "click", MetricGroundPoint(x_m=21.5, y_m=-21), 1,
                                target=MetricGroundPoint(x_m=6.5, y_m=1)).polygon is None


def test_selected_request_requires_snapshot_fields_and_finite_coordinates():
    from pydantic import ValidationError

    from app.main import LineParkingRequest

    payload = {"request_id": "606d0f2c-c8ba-4f38-b1e4-fc809dfc9d2a", "family": "click",
               "owner_key": "a" * 64, "observed_at": "2026-11-27T10:00:00Z"}
    for extra in [{"target": {"x_m": 1, "y_m": 1}},
                  {"target": {"x_m": float("nan"), "y_m": 1}, "parking_area_id": "area", "lot_model_version": 1}]:
        with pytest.raises(ValidationError):
            LineParkingRequest.model_validate({**payload, **extra})
