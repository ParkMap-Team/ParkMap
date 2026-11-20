from shapely.geometry import box

from app.models import LiveRegion, MetricGroundPoint, ParkingAreaLiveState
from app.services.parking_analysis_service import _geometry


def test_rider_clearance_can_change_without_changing_guard_booth_policy(monkeypatch):
    from app.services import rider_map_fitting
    from app.services.guard_booth_fitting import fit_recorded_preview

    row = _geometry(box(5, 0, 15, 1.9))["polygons"][0]
    gap = _geometry(box(5, 0, 5.71, 1.9))["polygons"][0]
    area = ParkingAreaLiveState(parking_area_id="area", status="DEMO", source="STILL_IMAGE_LOOP", regions=[
        LiveRegion(kind="UNKNOWN", row_id="row_5", polygon=row),
        LiveRegion(kind="WIDTH_SUFFICIENT", row_id="row_5", polygon=gap, width_m=.71),
    ])
    entrance = MetricGroundPoint(x_m=21.5, y_m=-21)
    # The main map uses body reference width only: .693 m fits a .71 m gap.
    assert any(r.kind == "WIDTH_SUFFICIENT" for r in rider_map_fitting.free_ground_for(area, "scoopy", 1).regions)
    assert fit_recorded_preview(area, "scoopy", entrance, 1).polygon is None

    from app.services import guard_booth_fitting

    monkeypatch.setattr(rider_map_fitting, "RIDER_CLEARANCE_M", .05)
    monkeypatch.setattr(guard_booth_fitting, "GUARD_BOOTH_CLEARANCE_M", 0.)
    assert not any(r.kind == "WIDTH_SUFFICIENT" for r in rider_map_fitting.free_ground_for(area, "scoopy", 1).regions)
    assert fit_recorded_preview(area, "scoopy", entrance, 1).polygon is not None

    monkeypatch.setattr(rider_map_fitting, "RIDER_CLEARANCE_M", 0.)
    monkeypatch.setattr(guard_booth_fitting, "GUARD_BOOTH_CLEARANCE_M", .05)
    assert any(r.kind == "WIDTH_SUFFICIENT" for r in rider_map_fitting.free_ground_for(area, "scoopy", 1).regions)
    assert fit_recorded_preview(area, "scoopy", entrance, 1).polygon is None
