import json
from datetime import UTC, datetime

import pytest

from app.services.segmentation_experiment_service import SegmentationExperimentResult
from app.services.segmentation_gap_service import SegmentationGapResult

NOW = datetime(2026, 11, 11, tzinfo=UTC)


def inputs():
    polygon = [{"x_m": x, "y_m": y} for x, y in [(0, 0), (.66, 0), (.66, 2), (0, 2)]]
    segmentation = SegmentationExperimentResult(model="local-seg.pt", image_width=100, image_height=100,
        processing_time_ms=1, imgsz=100, detections=[{"confidence": .8, "bbox": {"x": .1, "y": .1, "width": .1, "height": .2}}])
    gaps = SegmentationGapResult.model_validate({"calibration_version": "v1", "occupancy_source": "SEGMENTATION_ONLY",
        "evaluation_mode": "CONTINUOUS_GAPS", "target_length_m": None, "green_count": 1,
        "rows": [{"row_id": "row_1", "state": "WIDTH_SUFFICIENT", "fit_count": 1, "unknown_count": 0, "polygon_metric": polygon}],
        "occupied_layers": [{"detection_id": "detection_1", "detection_index": 0, "assigned_row_id": "row_1",
            "source": "SEGMENTATION", "geometry": {"polygons": [[polygon]]}, "roi_geometry": {"polygons": [[polygon]]}}]})
    return segmentation, gaps


def publish(segmentation, gaps, **overrides):
    from app.services.live_state_service import build_segmentation_state_publish

    return build_segmentation_state_publish(segmentation, gaps, camera_id="camera-1", parking_area_id="area-1",
        source=overrides.get("source", "STILL_IMAGE_LOOP"), observed_at=NOW, processed_at=NOW,
        calibration_version="v1", calibration_provenance=overrides.get("provenance", "MEASURED"))


def test_publication_uses_row_band_for_red_and_horizontal_reference_for_vehicle_only():
    from app.models import MetricGroundPoint
    from app.services.horizontal_vehicle_service import HorizontalVehicleClearance

    segmentation, gaps = inputs()
    band = [{"x_m": x, "y_m": y} for x, y in [(0, 0), (.66, 0), (.66, 1.9), (0, 1.9)]]
    gaps.occupied_layers[0].row_depth_geometry = gaps.occupied_layers[0].geometry.model_validate({"polygons": [[band]]})
    horizontal = [MetricGroundPoint(x_m=x, y_m=y) for x, y in [(0, 0), (2, 0), (2, .66), (0, .66)]]
    gaps.horizontal_vehicles = [HorizontalVehicleClearance(detection_id="detection_1", detection_index=0,
        pixel_aspect_ratio=2., polygon_metric=horizontal, measurement_status="NO_COMPARABLE_NEIGHBOR")]
    state = publish(segmentation, gaps)
    red = [r for r in state.regions if r.kind == "OCCUPIED"]
    assert len(red) == 1
    assert red[0].polygon[0][2].y_m == pytest.approx(1.9)
    assert state.motorcycles[0].heading_rad == pytest.approx(0.)
    assert state.motorcycles[0].length_m == pytest.approx(2.)
    assert len(state.motorcycles) == 1  # one ID is never drawn twice
    gaps.occupied_layers = []
    assert len(publish(segmentation, gaps).motorcycles) == 1  # horizontal in an aisle


def test_segmentation_publication_keeps_width_only_green_unknown_and_standard_car_proxy():
    segmentation, gaps = inputs()
    result = publish(segmentation, gaps)
    assert [(r.kind, r.row_id) for r in result.regions] == [("UNKNOWN", "row_1"), ("OCCUPIED", "row_1")]
    assert result.analysis_version == "segmentation-width-preview-v1"
    assert result.motorcycles[0].detection_id == "detection_1"
    assert result.motorcycles[0].confidence == .8
    assert result.motorcycles[0].length_m == pytest.approx(2.)
    assert result.motorcycles[0].width_m == pytest.approx(.66)
    assert result.source == "STILL_IMAGE_LOOP"


def test_width_preview_is_published_separately_from_available_with_its_uncertainty():
    from app.services.segmentation_gap_service import GapCandidate

    segmentation, gaps = inputs()
    gaps.candidates = [GapCandidate(id="gap-1", row_id="row_1", state="UNKNOWN", width_check="SUFFICIENT",
        reasons=["GROUND_MAY_BE_OCCLUDED"], gap_width_m=1.2, nearest_clearance_m=None,
        polygon_metric=gaps.rows[0].polygon_metric, polygon_image=None, width_line_image=None,
        nearest_line_image=None, label_image=None)]
    result = publish(segmentation, gaps)
    assert [r.kind for r in result.regions] == ["UNKNOWN", "WIDTH_SUFFICIENT", "OCCUPIED"]
    assert result.regions[1].width_m == 1.2
    assert result.regions[1].reasons == ["GROUND_MAY_BE_OCCLUDED"]
    assert all(r.kind != "AVAILABLE" for r in result.regions)
    gaps.candidates[0].width_check = "INSUFFICIENT"
    assert [r.kind for r in publish(segmentation, gaps).regions] == ["UNKNOWN", "OCCUPIED"]
    gaps.candidates[0].width_check = "SUFFICIENT"
    assert [r.kind for r in publish(segmentation, gaps, source="LIVE_CAMERA", provenance="ESTIMATED").regions] == ["UNKNOWN"]


@pytest.mark.parametrize("change", [{"status": "CALIBRATION_REQUIRED"}, {"calibration_version": "old"}, {"occupancy_source": "COMBINED"}])
def test_invalid_segmentation_calibration_or_source_cannot_publish(change):
    segmentation, gaps = inputs()
    with pytest.raises(ValueError):
        publish(segmentation, gaps.model_copy(update=change))


def test_unassigned_detection_does_not_become_a_liff_car_and_live_estimates_stay_unknown():
    segmentation, gaps = inputs()
    gaps.occupied_layers[0].assigned_row_id = None
    result = publish(segmentation, gaps, source="LIVE_CAMERA", provenance="ESTIMATED")
    assert result.motorcycles == []
    assert all(r.kind == "UNKNOWN" for r in result.regions)


@pytest.mark.parametrize("calibration_changed", [False, True])
def test_worker_analyzes_seg_once_and_publishes_the_matching_gap_result(tmp_path, monkeypatch, calibration_changed):
    from types import SimpleNamespace

    import numpy as np

    import app.services.frame_analysis_service as analyzer
    import app.worker.__main__ as worker
    from app.services.cv_service import cv_service
    from app.worker.frames import Frame

    segmentation, gaps = inputs()
    polygon = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .9}, {"x": .1, "y": .9}]
    (tmp_path / "parking_calibration.json").write_text(json.dumps({"camera_id": "camera-1",
        "reference_image": {"width": 100, "height": 100}, "parking_roi": {"polygon": polygon},
        "rows": [{"id": "row_1", "name": "Row", "polygon": polygon}]}))
    monkeypatch.setattr(analyzer, "CONFIG_DIRECTORY", tmp_path)
    versions = iter([("v1", "MEASURED"), ("v2" if calibration_changed else "v1", "MEASURED")])
    monkeypatch.setattr(analyzer, "calibration_identity", lambda _: next(versions))
    calls = []

    def segmented(raw):
        assert raw.startswith(b"\xff\xd8")
        calls.append("seg")
        return segmentation

    def analyze(detection, result, **options):
        assert result is segmentation
        assert detection.model.name == "local-seg.pt"
        assert options["image_row_assignment"] is True
        assert options["visible_free_shapes"] is False
        return gaps

    def forbidden(*_):
        raise AssertionError("The standard detector must not run")

    monkeypatch.setattr(cv_service, "analyze_image", forbidden)
    monkeypatch.setattr(analyzer, "segmentation_experiment_service", SimpleNamespace(analyze_image=segmented, class_id=0,
        confidence=.25, iou=.5), raising=False)
    monkeypatch.setattr(analyzer, "analyze_segmentation_gaps", analyze, raising=False)
    frame = Frame(image=np.zeros((100, 100, 3), dtype=np.uint8), captured_at=NOW)
    if calibration_changed:
        with pytest.raises(worker.CalibrationFilesUnavailableError, match="changed during"):
            worker.analyze_frame(frame, parking_area_id="area-1", source="STILL_IMAGE_LOOP")
        assert calls == ["seg"]
        return
    state = worker.analyze_frame(frame,
        parking_area_id="area-1", source="STILL_IMAGE_LOOP")
    assert calls == ["seg"]
    assert len(state.motorcycles) == 1
    assert state.observed_at == NOW
    assert state.regions[0].kind == "UNKNOWN"
