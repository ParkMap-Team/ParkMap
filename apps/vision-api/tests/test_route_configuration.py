import pytest

from app.models import MetricGroundPoint


def test_route_settings_persist_arbitrary_waypoints_and_reject_stale_writes(tmp_path):
    from app.services.route_configuration import RouteConfiguration, RouteConflict, RouteSettings

    settings = RouteSettings(tmp_path)
    initial = settings.read()
    assert initial.configuration is None and initial.revision == "default"
    configuration = RouteConfiguration.model_validate({"rows": {
        f"row_{i}": {"waypoints": [{"x_m": 30., "y_m": -8.}, {"x_m": 31., "y_m": 15.}], "entry": "vertical"}
        for i in range(1, 6)
    }})
    saved = settings.save(configuration, initial.revision)
    assert RouteSettings(tmp_path).read() == saved
    assert saved.revision != "default"
    with pytest.raises(RouteConflict):
        settings.save(configuration, initial.revision)
    assert settings.read() == saved


def test_route_builder_keeps_custom_turns_and_joins_the_actual_destination():
    from app.services.route_configuration import RoutePlan, build_route

    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    target = MetricGroundPoint(x_m=24, y_m=13)
    plan = RoutePlan.model_validate({"waypoints": [{"x_m": 30, "y_m": -8}, {"x_m": 32, "y_m": 16},
                                                  {"x_m": 26, "y_m": 16}]})
    route = build_route(entrance, target, plan)
    assert [(p.x_m, p.y_m) for p in route] == [(21.5, -21), (30, -8), (32, 16), (26, 16), (24, 16), (24, 13)]


def test_saved_routes_drive_liff_and_preview_without_changing_fit_gates(tmp_path, monkeypatch):
    from shapely.geometry import box

    from app.models import LiveRegion, ParkingAreaLiveState
    from app.services import rider_recommendation as rider
    from app.services.route_configuration import RouteConfiguration, RouteSettings

    settings = RouteSettings(tmp_path)
    monkeypatch.setattr(rider, "route_settings", settings)
    config = RouteConfiguration.model_validate({"rows": {
        f"row_{i}": {"waypoints": [{"x_m": 32, "y_m": -6}, {"x_m": 33, "y_m": 18}], "entry": "vertical"}
        for i in range(1, 6)
    }})
    settings.save(config, "default")
    polygon = [[MetricGroundPoint(x_m=x, y_m=y) for x, y in [(20, 12), (28, 12), (28, 14), (20, 14)]]]
    area = ParkingAreaLiveState(parking_area_id="sripatum-near-lot", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_1", polygon=polygon),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_1", polygon=polygon, width_m=8),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    fit = rider.fit_recorded_preview(area, "grand_filano", entrance, scale=1)
    preview = rider.preview_routes({"row_1": box(20, 12, 28, 14)}, entrance)[0]
    assert [(p.x_m, p.y_m) for p in fit.route[1:3]] == [(32, -6), (33, 18)]
    assert preview.route[:3] == fit.route[:3]
    assert fit.polygon is not None
    assert rider.fit_recorded_preview(area, "grand_filano", entrance, 1, blocked=[polygon]).polygon is None
    assert rider.fit_recorded_preview(area.model_copy(update={"status": "STALE"}), "grand_filano", entrance, 1).polygon is None
