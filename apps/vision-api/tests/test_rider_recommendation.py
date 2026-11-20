from shapely.geometry import box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.parking_analysis_service import _geometry


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
