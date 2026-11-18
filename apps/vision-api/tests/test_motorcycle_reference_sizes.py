import json

import pytest
from pydantic import ValidationError

from app.services import motorcycle_reference_sizes
from app.services.motorcycle_reference_sizes import load_rules, reference_size
from app.services.virtual_fitting_service import LENGTH_M, WIDTH_M


def test_editable_catalog_keeps_the_standard_fallback():
    rules = load_rules()
    assert len(rules.classes) == 48
    assert {"wave", "pcx", "adv", "grand_filano", "cbr650r", "hd_road_glide"} <= rules.classes.keys()
    assert (rules.fallback.width_m, rules.fallback.length_m) == (WIDTH_M, LENGTH_M)
    assert rules.fallback.basis == "INITIAL_STANDARD_NOT_MEASURED"


def test_missing_mounted_catalog_uses_packaged_rules(tmp_path, monkeypatch):
    mounted_catalog = tmp_path / "mount" / "motorcycle_reference_sizes.json"
    packaged_catalog = motorcycle_reference_sizes.RULES_PATH
    monkeypatch.setattr(motorcycle_reference_sizes, "RULES_PATH", mounted_catalog)
    monkeypatch.setattr(motorcycle_reference_sizes, "PACKAGED_RULES_PATH", packaged_catalog)

    assert {"grand_filano", "forza"} <= load_rules().classes.keys()
    with pytest.raises(FileNotFoundError):
        load_rules(mounted_catalog)

    mounted_catalog.parent.mkdir()
    mounted_catalog.write_text("{}")
    with pytest.raises(ValidationError):
        load_rules()


def test_exact_class_mapping_reload_and_explicit_fallback(tmp_path):
    path = tmp_path / "sizes.json"
    data = {"schema_version": 1, "min_score": .5, "fallback": {"width_m": .66, "length_m": 2., "basis": "INITIAL_STANDARD_NOT_MEASURED"},
            "classes": {"wave": {"width_m": .8, "length_m": 2.3, "basis": "operator reference"}}}
    path.write_text(json.dumps(data))
    rules = load_rules(path)
    assert reference_size(rules, "wave", .9).width_m == .8
    assert reference_size(rules, "Wave", .9).reason == "CLASS_NOT_CONFIGURED"
    assert reference_size(rules, "wave", .2).reason == "BELOW_MIN_SCORE"
    assert reference_size(rules, None, None).reason == "NO_CLASSIFICATION"
    data["classes"]["wave"]["width_m"] = .9
    path.write_text(json.dumps(data))
    assert reference_size(load_rules(path), "wave", .9).width_m == .9
    for invalid in [0, -1, float("nan"), float("inf"), "0.8", True]:
        data["classes"]["wave"]["width_m"] = invalid
        path.write_text(json.dumps(data))
        with pytest.raises((ValidationError, ValueError)):
            load_rules(path)


def test_experimental_sizes_change_occupied_space_without_changing_standard_analysis(tmp_path):
    from app.models import DetectionResponse
    from app.services.motorcycle_reference_sizes import ReferenceDimensions
    from app.services.parking_analysis_service import ParkingAnalysisService

    config = tmp_path / "config"
    config.mkdir()
    (config / "ground_plane_homography.json").write_text(json.dumps({"camera_id": "test", "matrix": [[20, 0, 0], [0, 20, 0], [0, 0, 1]],
        "roi_metric": {"points": [{"x_m": 0, "y_m": 0}, {"x_m": 20, "y_m": 0}, {"x_m": 20, "y_m": 20}, {"x_m": 0, "y_m": 20}]}}))
    (config / "ground_plane_calibration.json").write_text(json.dumps({"measured_rows": {"row_1": {"length_m": 10, "width_m": 3}}}))
    (config / "parking_calibration.json").write_text(json.dumps({"rows": [{"id": "row_1", "polygon": [{"x": .1, "y": .1}, {"x": .6, "y": .1}, {"x": .6, "y": .25}, {"x": .1, "y": .25}]}]}))
    service = ParkingAnalysisService()
    service.root = tmp_path
    detection = DetectionResponse(image_width=100, image_height=100, model={"name": "test"},
        inference={"imgsz": 640, "confidence_threshold": .25, "nms_iou": .7, "processing_time_ms": 1},
        detections=[{"class_id": 0, "class_name": "motorcycle", "confidence": .9, "bbox": {"x": .19, "y": .08, "width": .02, "height": .03}}])
    baseline = service.analyze(detection)
    default = ReferenceDimensions(width_m=WIDTH_M, length_m=LENGTH_M, basis="initial")
    same = service.analyze(detection, reference_sizes=[default])
    assert same["occupied_space"] == baseline["occupied_space"]
    changed = service.analyze(detection, reference_sizes=[ReferenceDimensions(width_m=.8, length_m=2.5, basis="test reference")])
    assert changed["occupied_space"]["rows"][0]["occupied_union_area_m2"] == pytest.approx(2.)
    assert changed["free_space"]["rows"][0]["free_area_m2"] < baseline["free_space"]["rows"][0]["free_area_m2"]
    assert changed["reference_size_experiment"]["status"] == "EXPERIMENTAL"
    assert service.analyze(detection) == baseline
    with pytest.raises(ValueError, match="detection"):
        service.analyze(detection, reference_sizes=[])
