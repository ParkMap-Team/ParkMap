import pytest

from shapely.geometry import box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.parking_analysis_service import _geometry
from app.services.region_clipping_service import polygon_shape
from app.services.rider_recommendation import fit_recorded_preview


@pytest.fixture(autouse=True)
def isolated_routes(tmp_path, monkeypatch):
    from app.services import rider_recommendation
    from app.services.route_configuration import RouteSettings

    monkeypatch.setattr(rider_recommendation, "route_settings", RouteSettings(tmp_path))


def test_route_preview_shows_all_rows_even_without_parking_evidence():
    from app.services.rider_recommendation import preview_routes

    rows = {f"row_{i}": box(20, 16 - i * 3, 28, 18 - i * 3) for i in range(1, 6)}
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    routes = preview_routes(rows, entrance)
    assert {r.row_id for r in routes} == set(rows)
    assert [r.label for r in routes] == ["E", "D", "C", "B", "A"]
    for item in routes:
        center = rows[item.row_id].centroid
        assert item.route[0] == entrance
        assert (item.route[-1].x_m, item.route[-1].y_m) == (center.x, center.y)
        assert item.route[-3].x_m == 28.9
        assert item.route[-2].y_m == (15.0 if item.row_id == "row_1" else 10.2 if item.row_id in {"row_2", "row_3"} else 3.2)
    assert preview_routes({}, entrance) == []


def test_rider_recommendation_owns_clearance_and_route_configuration(monkeypatch):
    from app.services import guard_booth_fitting, rider_recommendation

    monkeypatch.setattr(guard_booth_fitting, "GUARD_BOOTH_CLEARANCE_M", .05)
    row = _geometry(box(5, 0, 15, 1.9))["polygons"][0]
    gap = _geometry(box(5, 0, 5.71, 1.9))["polygons"][0]
    area = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=row),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=gap, width_m=.71),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    fit = rider_recommendation.fit_recorded_preview(area, "scoopy", entrance, 1)
    assert fit.polygon is not None  # .693 m without the Guard Booth's .05 m clearance
    assert fit.route[-3].x_m == rider_recommendation.RIGHT_ACCESS_X
    assert guard_booth_fitting.fit_recorded_preview(area, "scoopy", entrance, 1).polygon is None

    monkeypatch.setattr(guard_booth_fitting, "AISLES", {})
    monkeypatch.setattr(guard_booth_fitting, "RIGHT_ACCESS_X", 1.)
    assert rider_recommendation.fit_recorded_preview(area, "scoopy", entrance, 1) == fit

    monkeypatch.setattr(rider_recommendation, "AISLES", {})
    assert rider_recommendation.fit_recorded_preview(area, "scoopy", entrance, 1).polygon is None


def test_liff_routes_to_row_e_from_above_and_preserves_fit_gates():
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in
                [(24, 12), (24.8, 12), (24.8, 13.9), (24, 13.9)]]]
    row = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in
            [(20, 12), (28, 12), (28, 13.9), (20, 13.9)]]]
    area = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_1", polygon=row),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_1", polygon=polygon, width_m=.8),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    fit = fit_recorded_preview(area, "grand_filano", entrance, scale=1)
    assert fit.polygon is not None
    assert polygon_shape(polygon).covers(polygon_shape(fit.polygon))
    destination = polygon_shape(fit.polygon).centroid
    assert [(p.x_m, p.y_m) for p in fit.route] == pytest.approx([
        (21.5, -21), (21.5, -8), (28.9, -8), (28.9, 15.0),
        (destination.x, 15.0), (destination.x, destination.y),
    ])
    assert fit_recorded_preview(area, "grand_filano", entrance, scale=1, preferred=fit.polygon).route == fit.route
    assert fit_recorded_preview(area, "grand_filano", entrance, scale=1, blocked=[polygon]).polygon is None
    assert fit_recorded_preview(area, "hd_road_glide", entrance, scale=1).polygon is None
    for status in ("STALE", "NO_DATA", "CALIBRATION_MISMATCH"):
        rejected = fit_recorded_preview(area.model_copy(update={"status": status}), "grand_filano", entrance, scale=1)
        assert rejected.polygon is None and rejected.route == []
