import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError
from shapely.geometry import Polygon

from app.models import DetectionResponse, LotModelDefinition, ParkingStatePublish
from app.services.live_state_service import (
    CalibrationFilesUnavailableError,
    build_state_publish,
    calibration_identity,
    calibration_version,
    evaluate_area_state,
    unmonitored_polygons,
    validate_lot_model,
)
from app.services.parking_analysis_service import ParkingAnalysisService
from app.services.virtual_fitting_service import LENGTH_M, WIDTH_M

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


def publish(value=None, *, source="LIVE_CAMERA", provenance="MEASURED", observed_at=NOW, processed_at=NOW, **overrides):
    return build_state_publish(
        value or analysis(**overrides),
        parking_area_id="area-1",
        source=source,
        observed_at=observed_at,
        processed_at=processed_at,
        calibration_version="v1",
        calibration_provenance=provenance,
    )


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


def test_live_camera_on_estimated_calibration_publishes_only_unknown_regions():
    state = publish(provenance="ESTIMATED")

    assert [region.kind for region in state.regions] == ["UNKNOWN"]
    assert [proxy.detection_id for proxy in state.motorcycles] == ["d1"]


@pytest.mark.parametrize("source", ["RECORDED_REPLAY", "STILL_IMAGE_LOOP"])
def test_non_live_source_may_use_an_estimated_calibration(source):
    state = publish(source=source, provenance="ESTIMATED")

    assert [region.kind for region in state.regions] == ["AVAILABLE", "ALMOST_AVAILABLE"]
    assert state.calibration_provenance == "ESTIMATED"


def test_contract_rejects_candidate_regions_from_a_live_camera_on_estimated_calibration():
    payload = publish(source="RECORDED_REPLAY", provenance="ESTIMATED").model_dump()

    with pytest.raises(ValidationError, match="UNKNOWN"):
        ParkingStatePublish.model_validate({**payload, "source": "LIVE_CAMERA"})


def test_contract_rejects_processing_before_the_observation():
    payload = publish().model_dump()

    with pytest.raises(ValidationError, match="processed_at"):
        ParkingStatePublish.model_validate({**payload, "processed_at": NOW - timedelta(seconds=1)})


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


PHOTO_TIME = NOW - timedelta(days=30)


def still_image_state(processed_at=NOW):
    return publish(source="STILL_IMAGE_LOOP", provenance="ESTIMATED", observed_at=PHOTO_TIME, processed_at=processed_at)


def test_freshly_processed_still_image_is_demo_with_regions_and_its_photo_time():
    result = evaluate(still_image_state(), now=NOW + timedelta(seconds=4))

    assert result.status == "DEMO"
    assert result.age_s == 4
    assert result.observed_at == PHOTO_TIME
    assert result.processed_at == NOW
    assert {region.kind for region in result.regions} == {"AVAILABLE", "ALMOST_AVAILABLE"}


@pytest.mark.parametrize("now", [NOW + timedelta(seconds=16), NOW - timedelta(seconds=6)])
def test_stale_still_image_processing_carries_no_regions(now):
    result = evaluate(still_image_state(), now=now)

    assert result.status == "STALE"
    assert result.regions == []
    assert result.motorcycles == []


def test_live_freshness_still_uses_the_observation_time():
    result = evaluate(publish(observed_at=NOW - timedelta(seconds=60), processed_at=NOW), now=NOW)

    assert result.status == "STALE"


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


def test_sripatum_lot_model_leaves_ground_outside_the_parking_roi_unmonitored():
    path = Path(__file__).resolve().parents[1] / "fixtures" / "sripatum-lot-model.json"
    definition = LotModelDefinition.model_validate(json.loads(path.read_text(encoding="utf-8")))
    validate_lot_model(definition)

    assert [area.parking_area_id for area in definition.parking_areas] == ["sripatum-near-lot"]
    assert len(unmonitored_polygons(definition)) == 1
    # The surroundings are traced from imagery, so none of them may claim a site measurement.
    assert {landmark.measurement_source for landmark in definition.landmarks} == {"ESTIMATED"}
    kinds = {landmark.landmark_id: landmark.kind for landmark in definition.landmarks}
    assert kinds["entrance-exit"] == "ENTRANCE_EXIT"
    assert kinds["guard-booth"] == "GUARD_BOOTH"
    # Building 9 is one named building: a brick and glass podium under a banded tower.
    buildings = {landmark.landmark_id: (landmark.name, landmark.facade) for landmark in definition.landmarks if landmark.kind == "BUILDING"}
    assert buildings == {"building-9-podium": (None, "BRICK_AND_GLASS"), "building-9": ("อาคาร 9", "WINDOW_BANDS")}
    # The hedge stands on the far curb, which is also the outline's far edge.
    hedge = next(landmark for landmark in definition.landmarks if landmark.landmark_id == "hedge")
    assert min(point.y_m for point in hedge.polygon[0]) == max(point.y_m for point in definition.outline[0])
    # Nothing raised stands on the monitored area, so no block hides a parking region.
    monitored = Polygon([(point.x_m, point.y_m) for point in definition.parking_areas[0].polygon[0]])
    raised = [landmark for landmark in definition.landmarks if landmark.height_m is not None and landmark.polygon is not None]
    assert all(Polygon([(point.x_m, point.y_m) for point in landmark.polygon[0]]).intersection(monitored).area == 0 for landmark in raised)


def test_spu_cam_01_lot_model_uses_only_the_calibrated_parking_roi():
    root = Path(__file__).resolve().parents[1]
    definition = LotModelDefinition.model_validate(json.loads((root / "fixtures" / "spu-cam-01-lot-model.json").read_text(encoding="utf-8")))

    validate_lot_model(definition)

    assert [area.parking_area_id for area in definition.parking_areas] == ["sripatum-near-lot"]
    assert len(definition.parking_areas[0].polygon[0]) == 6
    assert definition.outline == definition.parking_areas[0].polygon
    assert {"TREE", "ROAD", "WALKWAY"}.issubset({landmark.kind for landmark in definition.landmarks})
    assert unmonitored_polygons(definition) == []


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


def lot_model_with(*landmarks):
    return LotModelDefinition.model_validate(
        {"outline": [ring(0, 0, 20, 10)], "parking_areas": [{"parking_area_id": "area-1", "polygon": [ring(0, 0, 10, 10)]}], "landmarks": list(landmarks)}
    )


def test_lot_model_landmarks_default_to_none():
    assert lot_model(ring(0, 0, 10, 10)).landmarks == []


def test_lot_model_keeps_surveyed_landmarks():
    definition = lot_model_with(
        {"landmark_id": "gate", "kind": "ENTRANCE", "position": {"x_m": 0, "y_m": 5}, "direction_rad": 0.0},
        {"landmark_id": "booth", "kind": "GUARD_BOOTH", "position": {"x_m": 1, "y_m": 11}, "polygon": [ring(0, 10.5, 2, 11.5)]},
        {"landmark_id": "hedge", "kind": "BARRIER", "name": "แนวพุ่มไม้", "position": {"x_m": 10, "y_m": 10}, "line": [{"x_m": 0, "y_m": 10}, {"x_m": 20, "y_m": 10}]},
    )
    validate_lot_model(definition)

    assert [landmark.kind for landmark in definition.landmarks] == ["ENTRANCE", "GUARD_BOOTH", "BARRIER"]
    assert {landmark.measurement_source for landmark in definition.landmarks} == {"ESTIMATED"}


def test_lot_model_keeps_estimated_surroundings():
    definition = lot_model_with(
        {"landmark_id": "tower", "kind": "BUILDING", "name": "อาคาร 9", "position": {"x_m": 5, "y_m": 30}, "polygon": [ring(0, 25, 10, 35)], "height_m": 55.0, "facade": "WINDOW_BANDS"},
        {"landmark_id": "tree", "kind": "TREE", "position": {"x_m": 2, "y_m": 0}, "height_m": 6.0, "radius_m": 2.0},
        {"landmark_id": "road", "kind": "ROAD", "position": {"x_m": 10, "y_m": -5}, "polygon": [ring(0, -8, 20, -3)]},
        {"landmark_id": "canopy", "kind": "SHELTER", "position": {"x_m": -1, "y_m": 5}, "polygon": [ring(-2, 0, -1, 10)], "height_m": 3.0},
        {"landmark_id": "hedge", "kind": "PLANTING", "position": {"x_m": 10, "y_m": 10.5}, "polygon": [ring(0, 10, 20, 11)], "height_m": 1.0, "measurement_source": "MEASURED"},
    )
    validate_lot_model(definition)

    assert [(landmark.kind, landmark.height_m) for landmark in definition.landmarks] == [
        ("BUILDING", 55.0),
        ("TREE", 6.0),
        ("ROAD", None),
        ("SHELTER", 3.0),
        ("PLANTING", 1.0),
    ]
    assert definition.landmarks[0].facade == "WINDOW_BANDS"
    assert definition.landmarks[1].radius_m == 2.0
    assert definition.landmarks[4].measurement_source == "MEASURED"


@pytest.mark.parametrize(
    ("landmarks", "message"),
    [
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}},) * 2, "landmarks must be unique"),
        (({"landmark_id": "a", "kind": "AISLE", "position": {"x_m": 0, "y_m": 0}},), "Aisle landmarks need their polygon"),
        (({"landmark_id": "a", "kind": "ROAD", "position": {"x_m": 0, "y_m": 0}},), "Road landmarks need their polygon"),
        (({"landmark_id": "a", "kind": "TREE", "position": {"x_m": 0, "y_m": 0}, "height_m": 6.0},), "needs its height and canopy radius"),
        (({"landmark_id": "a", "kind": "TREE", "position": {"x_m": 0, "y_m": 0}, "height_m": 2.0, "radius_m": 3.0},), "cannot exceed the tree height"),
        (
            ({"landmark_id": "a", "kind": "TREE", "position": {"x_m": 0, "y_m": 0}, "height_m": 6.0, "radius_m": 2.0, "polygon": [ring(0, 0, 1, 1)]},),
            "tree landmark has no polygon",
        ),
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "radius_m": 1.0},), "Only a tree"),
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "height_m": 10.0},), "Only a footprint"),
        (({"landmark_id": "a", "kind": "ROAD", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "height_m": 1.0},), "Only a footprint"),
        (({"landmark_id": "a", "kind": "SHELTER", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)]},), "needs its roof height"),
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "height_m": 0.0},), "greater than 0"),
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "facade": "WINDOW_BANDS"},), "Only a raised building"),
        (({"landmark_id": "a", "kind": "GUARD_BOOTH", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "height_m": 2.5, "facade": "BRICK_AND_GLASS"},), "Only a raised building"),
        (({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "height_m": 9.0, "facade": "MARBLE"},), "Input should be"),
        (({"landmark_id": "a", "kind": "GUARD_BOOTH", "position": {"x_m": 0, "y_m": 0}, "direction_rad": 1.0},), "Only an entrance or an exit"),
        (({"landmark_id": "a", "kind": "ENTRANCE_EXIT", "position": {"x_m": 0, "y_m": 0}, "direction_rad": 1.0},), "Only an entrance or an exit"),
        (
            ({"landmark_id": "a", "kind": "BARRIER", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 1, 1)], "line": [{"x_m": 0, "y_m": 0}, {"x_m": 1, "y_m": 0}]},),
            "not both",
        ),
    ],
)
def test_invalid_landmarks_are_rejected(landmarks, message):
    with pytest.raises(ValidationError, match=message):
        lot_model_with(*landmarks)


def test_landmark_footprints_must_have_area():
    definition = lot_model_with({"landmark_id": "a", "kind": "BUILDING", "position": {"x_m": 0, "y_m": 0}, "polygon": [ring(0, 0, 0, 1)]})

    with pytest.raises(ValueError, match="Landmark a must be a valid polygon"):
        validate_lot_model(definition)


def ground_calibration(provenance):
    point = {"provenance": "MEASURED"} if provenance == "MEASURED" else {"provenance": "ESTIMATED", "uncertainty_m": 0.5, "estimation_basis": "Paced in the reference photo."}
    corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return json.dumps(
        {
            "camera_id": "camera-1",
            "reference_image": {"width": 1920, "height": 1080},
            "coordinate_system": {"unit": "meter"},
            "control_points": [{"id": f"P{index}", "image_x": x, "image_y": y, "ground_x_m": x * 10, "ground_y_m": y * 10, **point} for index, (x, y) in enumerate(corners)],
        }
    )


@pytest.mark.parametrize("provenance", ["MEASURED", "ESTIMATED"])
def test_calibration_identity_reports_the_version_and_provenance_of_the_same_files(tmp_path, provenance):
    write_calibration(tmp_path)
    (tmp_path / "ground_plane_calibration.json").write_text(ground_calibration(provenance))

    assert calibration_identity(tmp_path) == (calibration_version(tmp_path), provenance)


def test_calibration_identity_rejects_an_invalid_ground_calibration(tmp_path):
    write_calibration(tmp_path)

    with pytest.raises(CalibrationFilesUnavailableError, match="ground_plane_calibration.json"):
        calibration_identity(tmp_path)


# The standard motorcycle footprint through the whole analysis -> publish path.
def write_analysis_config(root):
    config = root / "config"
    config.mkdir()
    scale = 20.0  # normalized image coordinates -> metres
    (config / "ground_plane_homography.json").write_text(json.dumps({
        "camera_id": "camera-1",
        "matrix": [[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]],
        "inverse_matrix": [[1 / scale, 0.0, 0.0], [0.0, 1 / scale, 0.0], [0.0, 0.0, 1.0]],
        "roi_metric": {"points": [{"x_m": 0.0, "y_m": 0.0}, {"x_m": 20.0, "y_m": 0.0}, {"x_m": 20.0, "y_m": 20.0}, {"x_m": 0.0, "y_m": 20.0}]},
    }))
    (config / "ground_plane_calibration.json").write_text(json.dumps({"measured_rows": {"row_1": {"length_m": 10.0, "width_m": 3.0}}}))
    row = [{"x": 0.1, "y": 0.1}, {"x": 0.6, "y": 0.1}, {"x": 0.6, "y": 0.25}, {"x": 0.1, "y": 0.25}]
    (config / "parking_calibration.json").write_text(json.dumps({"rows": [{"id": "row_1", "polygon": row}]}))


def analyzed(root, boxes, source):
    service = ParkingAnalysisService()
    service.root = root
    detection = DetectionResponse.model_validate({
        "image_width": 1920,
        "image_height": 1080,
        "model": {"name": "test"},
        "inference": {"imgsz": 640, "confidence_threshold": 0.25, "nms_iou": 0.7, "processing_time_ms": 1.0},
        "detections": [{"class_id": 0, "class_name": "motorcycle", "confidence": 0.9, "bbox": box} for box in boxes],
    })
    return publish(service.analyze(detection), source=source, provenance="ESTIMATED")


def box(ground_x, ground_y, width, height):
    """A normalized box whose bottom-centre ground point stays fixed while its size varies."""
    return {"x": ground_x - width / 2, "y": ground_y - height, "width": width, "height": height}


SMALL_BOXES = [box(0.2, 0.12, 0.02, 0.03), box(0.35, 0.12, 0.03, 0.04)]
LARGE_BOXES = [box(0.2, 0.12, 0.12, 0.11), box(0.35, 0.12, 0.2, 0.1)]


def test_still_image_loop_proxies_use_the_standard_footprint_whatever_the_detection_size(tmp_path):
    write_analysis_config(tmp_path)

    for boxes in (SMALL_BOXES, LARGE_BOXES):
        motorcycles = analyzed(tmp_path, boxes, "STILL_IMAGE_LOOP").motorcycles
        assert len(motorcycles) == 2
        for proxy in motorcycles:
            assert proxy.length_m == pytest.approx(LENGTH_M)
            assert proxy.width_m == pytest.approx(WIDTH_M)


def test_still_image_loop_candidate_regions_do_not_depend_on_detection_size(tmp_path):
    write_analysis_config(tmp_path)

    small = analyzed(tmp_path, SMALL_BOXES, "STILL_IMAGE_LOOP")
    large = analyzed(tmp_path, LARGE_BOXES, "STILL_IMAGE_LOOP")

    assert {region.kind for region in small.regions} & {"AVAILABLE", "ALMOST_AVAILABLE"}
    assert small.regions == large.regions
    for region in small.regions:
        if region.kind != "UNKNOWN":
            area = Polygon([(point.x_m, point.y_m) for point in region.polygon[0]]).area
            assert area == pytest.approx(LENGTH_M * WIDTH_M)


def test_other_sources_publish_the_same_footprints_as_a_still_image_loop(tmp_path):
    write_analysis_config(tmp_path)
    still = analyzed(tmp_path, SMALL_BOXES, "STILL_IMAGE_LOOP")

    for source in ("RECORDED_REPLAY", "SYNTHETIC_FIXTURE"):
        state = analyzed(tmp_path, SMALL_BOXES, source)
        assert state.regions == still.regions
        assert state.motorcycles == still.motorcycles
