import math
from datetime import UTC, datetime, timedelta

import pytest

from app.models import LotModelDefinition
from app.services.live_state_service import (
    CalibrationFilesUnavailableError,
    build_state_publish,
    calibration_version,
    evaluate_area_state,
    unmonitored_polygons,
    validate_lot_model,
)

NOW = datetime(2026, 10, 1, 8, 0, tzinfo=UTC)


def ring(x0, y0, x1, y1):
    return [{"x_m": x0, "y_m": y0}, {"x_m": x1, "y_m": y0}, {"x_m": x1, "y_m": y1}, {"x_m": x0, "y_m": y1}]


def geometry(*rings):
    return {"polygons": [[item] for item in rings]}


def analysis(*, row_state="AVAILABLE", row_valid=True, capacity_valid=True, overall_valid=True):
    return {
        "analysis_version": "parking-analysis-v2",
        "camera_id": "camera-1",
        "physical_map": {"rows": [{"row_id": "row_1", "polygon": ring(0, 0, 10, 2)}]},
        "capacity": {"rows": [{"row_id": "row_1", "placements": [{"footprint_metric": geometry(ring(8, 0, 10, 0.66))}], "validation": {"valid": capacity_valid}}]},
        "almost_available_placements": [{"row_id": "row_1", "footprint_metric": geometry(ring(5, 0, 7, 0.66))}],
        "parking_state": {"rows": [{"row_id": "row_1", "state": row_state, "validation": row_valid}], "validation": overall_valid},
        "detections": [
            {"detection_id": "d1", "confidence": 0.9, "inside_parking_roi": True, "canonical_footprint": geometry(ring(0, 0, 2, 0.66))},
            {"detection_id": "d2", "confidence": 0.8, "inside_parking_roi": False, "canonical_footprint": geometry(ring(20, 0, 22, 0.66))},
        ],
    }


def publish(value=None, **overrides):
    return build_state_publish(value or analysis(**overrides), parking_area_id="area-1", source="LIVE_CAMERA", observed_at=NOW, calibration_version="v1")


def test_trusted_row_publishes_available_and_almost_available_regions():
    state = publish()

    assert [(region.kind, region.row_id) for region in state.regions] == [("AVAILABLE", "row_1"), ("ALMOST_AVAILABLE", "row_1")]
    assert state.camera_id == "camera-1"
    assert state.analysis_version == "parking-analysis-v2"


@pytest.mark.parametrize(
    "overrides",
    [{"row_state": "UNCERTAIN"}, {"row_valid": False}, {"capacity_valid": False}, {"overall_valid": False}],
)
def test_unproven_row_is_unknown_and_never_available(overrides):
    state = publish(**overrides)

    assert [region.kind for region in state.regions] == ["UNKNOWN"]
    assert state.regions[0].polygon[0][2].x_m == 10


def test_row_missing_from_parking_state_is_unknown():
    value = analysis()
    value["parking_state"]["rows"] = []

    assert [region.kind for region in publish(value).regions] == ["UNKNOWN"]


def test_motorcycle_proxies_come_only_from_detections_inside_the_roi():
    motorcycles = publish().motorcycles

    assert [proxy.detection_id for proxy in motorcycles] == ["d1"]
    proxy = motorcycles[0]
    assert proxy.center.x_m == pytest.approx(1.0)
    assert proxy.center.y_m == pytest.approx(0.33)
    assert proxy.length_m == pytest.approx(2.0)
    assert proxy.width_m == pytest.approx(0.66)
    assert math.sin(proxy.heading_rad) == pytest.approx(0.0, abs=1e-9)


def evaluate(stored, *, active="v1", now=NOW):
    return evaluate_area_state("area-1", stored=stored, active_calibration_version=active, now=now, freshness_limit_s=15)


def test_area_without_active_calibration_is_not_calibrated_even_with_a_state():
    assert evaluate(publish(), active=None).status == "NOT_CALIBRATED"


def test_area_without_states_has_no_data():
    assert evaluate(None).status == "NO_DATA"


def test_fresh_state_is_live_with_regions():
    result = evaluate(publish(), now=NOW + timedelta(seconds=10))

    assert result.status == "LIVE"
    assert result.age_s == 10
    assert result.regions and result.motorcycles


@pytest.mark.parametrize(
    ("active", "now", "status"),
    [
        ("v2", NOW, "CALIBRATION_MISMATCH"),
        ("v1", NOW + timedelta(seconds=16), "STALE"),
        ("v1", NOW - timedelta(seconds=6), "STALE"),
    ],
)
def test_state_that_is_not_proven_current_carries_no_regions(active, now, status):
    result = evaluate(publish(), active=active, now=now)

    assert result.status == status
    assert result.regions == []
    assert result.motorcycles == []
    assert result.observed_at == NOW


def write_calibration(directory, content="{}"):
    for name in ("ground_plane_homography.json", "ground_plane_calibration.json", "parking_calibration.json"):
        (directory / name).write_text(content)


def test_calibration_version_is_stable_and_changes_with_content(tmp_path):
    write_calibration(tmp_path)
    first = calibration_version(tmp_path)

    assert first.startswith("files-sha256:")
    assert calibration_version(tmp_path) == first
    (tmp_path / "parking_calibration.json").write_text('{"camera_id": "camera-1"}')
    assert calibration_version(tmp_path) != first


def test_calibration_version_requires_every_file(tmp_path):
    write_calibration(tmp_path)
    (tmp_path / "ground_plane_homography.json").unlink()

    with pytest.raises(CalibrationFilesUnavailableError):
        calibration_version(tmp_path)


def lot_model(*areas):
    return LotModelDefinition.model_validate(
        {"outline": [ring(0, 0, 20, 10)], "parking_areas": [{"parking_area_id": f"area-{index}", "polygon": [area]} for index, area in enumerate(areas, 1)]}
    )


def test_unmonitored_ground_is_the_outline_minus_parking_areas():
    definition = lot_model(ring(0, 0, 10, 10))
    validate_lot_model(definition)

    unmonitored = unmonitored_polygons(definition)

    assert len(unmonitored) == 1
    xs = sorted({point.x_m for point in unmonitored[0][0]})
    assert xs == [10, 20]


def test_fully_monitored_lot_has_no_unmonitored_ground():
    assert unmonitored_polygons(lot_model(ring(0, 0, 20, 10))) == []


@pytest.mark.parametrize(
    ("areas", "message"),
    [
        ((ring(0, 0, 10, 10), ring(5, 0, 15, 10)), "overlaps"),
        ((ring(15, 0, 25, 10),), "inside the lot outline"),
        ((ring(0, 0, 0, 10),), "positive area"),
    ],
)
def test_invalid_lot_models_are_rejected(areas, message):
    with pytest.raises(ValueError, match=message):
        validate_lot_model(lot_model(*areas))
