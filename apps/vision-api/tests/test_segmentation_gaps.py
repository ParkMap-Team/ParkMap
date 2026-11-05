import pytest
from shapely.affinity import rotate
from shapely.geometry import Polygon, box

from app.services.capacity_service import calculate_capacity
from app.services.parking_analysis_service import _geometry
from app.services.segmentation_gap_service import evaluate_gap_geometry
from app.services.virtual_fitting_service import fit_rows


def scene(width=.66, depth=2., uncertain=False):
    row = Polygon([(0, 0), (2 + width, 0), (2 + width, depth), (0, depth)])
    occupied = box(0, 0, 1, depth).union(box(1 + width, 0, 2 + width, depth))
    free = row.difference(occupied)
    rows = [("row_1", row)]
    return {"physical_map": {"parking_roi": _geometry(row), "rows": [{"row_id": "row_1", "polygon": _geometry(row)["polygons"][0][0]}]},
        "detections": [{"canonical_footprint": _geometry(occupied)}],
        "capacity": calculate_capacity(rows, {"row_1": free}, fit_rows(rows, {"row_1": free})),
        "uncertainty": {"validation": True, "rows": [{"row_id": "row_1", "status": "UNCERTAIN" if uncertain else "CLEAR"}]}}


INVERSE = [[.1, 0, 0], [0, .1, 0], [0, 0, 1]]


def test_incoming_width_can_cross_one_metre_visual_grid():
    result = evaluate_gap_geometry(scene(6., 1.9), INVERSE, [], evidence_count=1, virtual_slots=True, slot_width_m=1.2)
    assert len(result.candidates) == 5
    assert result.green_count == 5
    assert result.target_width_m == pytest.approx(1.2)
    for candidate in result.candidates:
        shape = Polygon([(p.x_m, p.y_m) for p in candidate.polygon_metric])
        assert shape.area == pytest.approx(1.2*1.9)
        assert candidate.gap_width_m == pytest.approx(1.2)
    assert len(evaluate_gap_geometry(scene(1.19, 1.9), INVERSE, [], evidence_count=1, virtual_slots=True, slot_width_m=1.2).candidates) == 0


def test_six_metre_gap_produces_six_independent_one_by_two_slots():
    result = evaluate_gap_geometry(scene(6., 2.), INVERSE, [box(.101, 0, .12, .2)], evidence_count=1, virtual_slots=True)
    assert result.evaluation_mode == "VIRTUAL_SLOTS"
    assert result.target_width_m == 1.
    assert result.target_length_m is None
    assert len(result.candidates) == 6
    assert result.green_count == 5
    assert result.unknown_count == 1
    shapes = [Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]) for item in result.candidates]
    for index, shape in enumerate(shapes):
        assert shape.area == pytest.approx(2.)
        assert result.candidates[index].gap_width_m == pytest.approx(1.)
        assert all(shape.intersection(other).area < 1e-8 for other in shapes[:index])


def test_virtual_slots_follow_row_depth_and_do_not_round_up():
    result = evaluate_gap_geometry(scene(6.99, 1.9), INVERSE, [], evidence_count=1, virtual_slots=True)
    assert len(result.candidates) == 6
    assert result.green_count == 6
    assert all(item.slot_length_m == pytest.approx(1.9) for item in result.candidates)
    assert all(Polygon([(p.x_m, p.y_m) for p in item.polygon_metric]).area == pytest.approx(1.9) for item in result.candidates)
    assert all(item.source_gap_width_m == pytest.approx(6.99) for item in result.candidates)


def test_virtual_slots_respect_limit_and_keep_deterministic_ids(monkeypatch):
    from app.services import segmentation_gap_service

    monkeypatch.setattr(segmentation_gap_service, "MAX_CANDIDATES", 3)
    first = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    second = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    assert len(first.candidates) == 3
    assert first.truncated
    assert first == second
    assert all(item.slot_length_m == pytest.approx(1.46) for item in first.candidates)


def test_family_recommendations_use_exact_reference_width_and_only_green_gaps():
    from app.services.motorcycle_reference_sizes import ReferenceSizeRules
    from app.services.segmentation_gap_service import recommend_families_by_width

    rules = ReferenceSizeRules.model_validate({"schema_version": 1, "min_score": 0.,
        "fallback": {"width_m": .66, "length_m": 2., "basis": "fallback"},
        "classes": {name: {"width_m": width, "length_m": 3., "basis": "test reference"}
            for name, width in [("wave", .715), ("pcx", .742)]}})
    gap = evaluate_gap_geometry(scene(.73, 1.), INVERSE, [], evidence_count=1, width_only=True)
    recommend_families_by_width(gap, rules)
    assert [item.family for item in gap.candidates[0].compatible_families] == ["wave"]
    assert gap.candidates[0].compatible_families[0].width_clearance_m == pytest.approx(.015)
    assert gap.candidates[0].compatible_families[0].basis == "test reference"
    exact = evaluate_gap_geometry(scene(.742, 1.), INVERSE, [], evidence_count=1, width_only=True)
    recommend_families_by_width(exact, rules)
    assert [item.family for item in exact.candidates[0].compatible_families] == ["wave", "pcx"]
    assert exact.candidates[0].compatible_families[1].width_clearance_m == pytest.approx(0)
    hidden = evaluate_gap_geometry(scene(.8, 1.), INVERSE, [box(.1, 0, .18, .1)], evidence_count=1, width_only=True)
    recommend_families_by_width(hidden, rules)
    assert hidden.candidates[0].compatible_families == []
    rules.classes["pcx"] = rules.classes["pcx"].model_copy(update={"width_m": 1.01})
    slots = evaluate_gap_geometry(scene(6., 1.46), INVERSE, [], evidence_count=1, virtual_slots=True)
    recommend_families_by_width(slots, rules)
    assert all([item.family for item in slot.compatible_families] == ["wave"] for slot in slots.candidates)


def test_full_vehicle_fit_respects_rotated_obstacles_and_roi_holes():
    row = Polygon([(0, 0), (8, 0), (8, 3), (0, 3)])
    roi = row.difference(box(4, .5, 4.3, 1.5))
    occupied = rotate(box(1, .5, 1.8, 2.5), 20, origin=(1.4, 1.5))
    row, roi, occupied = [rotate(shape, 27, origin=(0, 0)) for shape in (row, roi, occupied)]
    free = roi.difference(occupied)
    rows = [("row_1", row)]
    analysis = {"physical_map": {"parking_roi": _geometry(roi), "rows": [{"row_id": "row_1", "polygon": _geometry(row)["polygons"][0][0]}]},
        "detections": [{"canonical_footprint": _geometry(occupied)}],
        "capacity": calculate_capacity(rows, {"row_1": free}, fit_rows(rows, {"row_1": free})),
        "uncertainty": {"validation": True, "rows": [{"row_id": "row_1", "status": "CLEAR"}]}}
    result = evaluate_gap_geometry(analysis, [[.04, 0, .4], [0, .04, .4], [0, 0, 1]], [], evidence_count=1)
    assert result.green_count > 0
    for candidate in result.candidates:
        if candidate.state == "FIT":
            shape = Polygon([(p.x_m, p.y_m) for p in candidate.polygon_metric])
            assert roi.buffer(1e-7).covers(shape)
            assert shape.intersection(occupied).area <= 1e-7
            assert shape.area == pytest.approx(.66 * 2.)


def test_all_width_gaps_report_sufficient_narrow_and_occluded_states():
    narrow = evaluate_gap_geometry(scene(.65, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert len(narrow.candidates) == 1
    assert narrow.candidates[0].state == "INSUFFICIENT_WIDTH"
    assert narrow.narrow_count == 1
    assert narrow.green_count == 0
    assert narrow.candidates[0].gap_width_m == pytest.approx(.65)
    blocked = evaluate_gap_geometry(scene(.65, 1.), INVERSE, [box(.1, 0, .165, .1)], evidence_count=1, width_only=True)
    assert blocked.candidates[0].state == "UNKNOWN"
    assert blocked.narrow_count == 0
    assert "GROUND_MAY_BE_OCCLUDED" in blocked.candidates[0].reasons
    enough = evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert enough.candidates[0].state == "WIDTH_SUFFICIENT"


def test_width_measurement_is_local_to_row_midline_and_layers_clip_to_roi():
    analysis = scene(.8, 2.)
    # A bike at the back blocks the old full-depth corridor, but not the midline.
    analysis["detections"].append({"canonical_footprint": _geometry(box(1, 1.5, 1.8, 2.))})
    analysis["detections"].append({"canonical_footprint": _geometry(box(20, 20, 21, 22))})
    result = evaluate_gap_geometry(analysis, INVERSE, [], evidence_count=1, width_only=True, primary_count=1)
    assert result.green_count == 1
    assert result.candidates[0].gap_width_m == pytest.approx(.8)
    assert result.candidates[0].width_line_metric[0].y_m == pytest.approx(1.)
    assert result.occupied_layers[0].source == "PRIMARY"
    assert result.occupied_layers[1].source == "SEGMENTATION"
    assert result.occupied_layers[2].roi_geometry.polygons == []


def test_top_down_uses_same_metric_geometry_and_preserves_unknown():
    result = evaluate_gap_geometry(scene(.8, 1.), INVERSE, [box(.1, 0, .18, .1)], evidence_count=1, width_only=True)
    assert result.parking_roi_metric.polygons[0][0][1].x_m == pytest.approx(2.8)
    assert len(result.occupied_metric.polygons) == 2
    assert result.rows[0].polygon_metric[1].x_m == pytest.approx(2.8)
    candidate = result.candidates[0]
    assert candidate.state == "UNKNOWN"
    assert candidate.polygon_metric
    assert candidate.width_line_metric[1].x_m - candidate.width_line_metric[0].x_m == pytest.approx(.8)
    assert candidate.label_metric is not None


def test_width_only_accepts_short_gap_without_claiming_full_vehicle_fit():
    result = evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=1, width_only=True)
    assert result.evaluation_mode == "WIDTH_ONLY"
    assert result.green_count == 1
    assert result.candidates[0].state == "WIDTH_SUFFICIENT"
    assert result.candidates[0].gap_width_m == pytest.approx(.66)
    assert evaluate_gap_geometry(scene(.65, 1.), INVERSE, [], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1.), INVERSE, [box(.1, 0, .166, .1)], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1., uncertain=True), INVERSE, [], evidence_count=1, width_only=True).green_count == 0
    assert evaluate_gap_geometry(scene(.66, 1.), INVERSE, [], evidence_count=0, width_only=True).green_count == 0
    outside_roi = scene(.66, 1.)
    outside_roi["physical_map"]["parking_roi"] = _geometry(box(0, 0, .5, 1))
    assert evaluate_gap_geometry(outside_roi, INVERSE, [], evidence_count=1, width_only=True).green_count == 0


def test_exact_standard_width_fits_and_reports_metric_gap():
    result = evaluate_gap_geometry(scene(), INVERSE, [], evidence_count=1)
    assert result.green_count >= 1
    candidate = next(item for item in result.candidates if item.state == "FIT")
    assert candidate.gap_width_m == pytest.approx(.66)
    assert candidate.nearest_clearance_m == pytest.approx(0)
    assert candidate.width_line_image and candidate.polygon_image
    assert result.rows[0].polygon_image
    assert result.rows[0].polygon_image[1].x == pytest.approx(.266)
    assert result.rows[0].label_image


@pytest.mark.parametrize("width,depth", [(.65, 2.), (.8, 1.99)])
def test_narrow_or_short_space_never_turns_green(width, depth):
    result = evaluate_gap_geometry(scene(width, depth), INVERSE, [], evidence_count=1)
    assert result.green_count == 0
    assert result.measured_gaps
    gap = result.measured_gaps[0]
    assert gap.width_m == pytest.approx(width)
    assert gap.depth_m == pytest.approx(depth)
    assert gap.state in {"INSUFFICIENT_WIDTH", "INSUFFICIENT_DEPTH"}


def test_occlusion_uncertainty_no_evidence_or_bad_projection_never_turns_green():
    assert evaluate_gap_geometry(scene(), INVERSE, [box(.1, 0, .166, .2)], evidence_count=1).green_count == 0
    assert evaluate_gap_geometry(scene(uncertain=True), INVERSE, [], evidence_count=1).green_count == 0
    assert evaluate_gap_geometry(scene(), INVERSE, [], evidence_count=0).green_count == 0
    assert evaluate_gap_geometry(scene(), [[0, 0, 0]] * 3, [], evidence_count=1).green_count == 0
    unsafe = scene()
    unsafe["physical_map"]["parking_roi"] = _geometry(box(0, 0, .5, 2))
    assert evaluate_gap_geometry(unsafe, INVERSE, [], evidence_count=1).green_count == 0


def test_saved_calibration_and_conservative_union_with_primary_only_vehicle(tmp_path, monkeypatch):
    from app.models import DetectionResponse, GroundPlaneCalibration, ParkingCalibration
    from app.services.ground_plane_homography_service import (
        GroundPlaneHomographyService,
    )
    from app.services.motorcycle_reference_sizes import ReferenceDimensions
    from app.services.parking_analysis_service import ParkingAnalysisService
    from app.services.segmentation_experiment_service import (
        SegmentationExperimentResult,
    )
    from app.services.segmentation_gap_service import analyze_segmentation_gaps

    directory = tmp_path / "config"
    directory.mkdir()
    ground = GroundPlaneCalibration.model_validate({"camera_id": "test", "reference_image": {"width": 100, "height": 100}, "coordinate_system": {"unit": "meter"},
        "control_points": [{"id": f"p{i}", "image_x": x, "image_y": y, "ground_x_m": x*10, "ground_y_m": y*10, "provenance": "MEASURED"} for i, (x, y) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1), (.5, .5)])],
        "measured_rows": {"row_1": {"length_m": 8, "width_m": 2, "provenance": "MEASURED"}}})
    roi = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .9}, {"x": .1, "y": .9}]
    row = [{"x": .1, "y": .1}, {"x": .9, "y": .1}, {"x": .9, "y": .3}, {"x": .1, "y": .3}]
    parking = ParkingCalibration.model_validate({"camera_id": "test", "reference_image": {"width": 100, "height": 100}, "parking_roi": {"polygon": roi}, "rows": [{"id": "row_1", "name": "row", "polygon": row}]})
    ground_path = directory / "ground_plane_calibration.json"
    ground_path.write_text(ground.model_dump_json())
    (directory / "parking_calibration.json").write_text(parking.model_dump_json())
    GroundPlaneHomographyService(directory).calculate(ground, parking)
    service = ParkingAnalysisService()
    service.root = tmp_path
    primary = DetectionResponse(image_width=100, image_height=100, model={"name": "test"}, inference={"imgsz": 960, "confidence_threshold": .25, "nms_iou": .5, "processing_time_ms": 1},
        detections=[{"class_id": 0, "class_name": "motorcycle", "confidence": .9, "bbox": {"x": .3, "y": .05, "width": .05, "height": .1}}])
    segmentation = SegmentationExperimentResult(model="seg", image_width=100, image_height=100, imgsz=960, processing_time_ms=1,
        detections=[{"confidence": .9, "bbox": {"x": .7, "y": .1, "width": .05, "height": .05}}])
    reference = [ReferenceDimensions(width_m=.9, length_m=2.3, basis="known reference")]
    result = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference)
    assert result.status == "EXPERIMENTAL"
    assert result.evaluation_mode == "VIRTUAL_SLOTS"
    assert result.access_status == "NOT_EVALUATED"
    assert result.calibration_source == "MEASURED"
    assert result.candidates
    primary_block = box(3.25-.45, 1.5, 3.25+.45, 1.5+2.3)
    for item in result.candidates:
        metric_shape = Polygon([(p.x_m, p.y_m) for p in item.polygon_metric])
        assert metric_shape.area == pytest.approx(item.gap_width_m * item.slot_length_m)
        assert item.state in {"SLOT_CLEAR", "UNKNOWN"}
        if item.polygon_image:
            shape = Polygon([(p.x*10, p.y*10) for p in item.polygon_image])
            assert shape.intersection(primary_block).area < 1e-7
    assert len(primary.detections) == 1
    incoming = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference, incoming_width_m=1.2)
    assert incoming.target_width_m == 1.
    assert incoming.incoming_vehicle.width_m == 1.2
    assert incoming.incoming_vehicle.allocation_width_m == 1.2
    assert incoming.incoming_vehicle.candidates
    assert all(item.gap_width_m == pytest.approx(1.2) for item in incoming.incoming_vehicle.candidates)
    assert not {item.id for item in incoming.candidates} & {item.id for item in incoming.incoming_vehicle.candidates}
    small = analyze_segmentation_gaps(primary, segmentation, service, incoming_width_m=.75)
    assert small.incoming_vehicle.allocation_width_m == 1.
    from app.services import motorcycle_reference_sizes

    broken_rules = tmp_path / "broken_sizes.json"
    broken_rules.write_text('{"schema_version": 999}', encoding="utf-8")
    monkeypatch.setattr(motorcycle_reference_sizes, "RULES_PATH", broken_rules)
    unavailable = analyze_segmentation_gaps(primary, segmentation, service, reference_sizes=reference)
    assert unavailable.status == "EXPERIMENTAL"
    assert unavailable.family_recommendation_error
    assert unavailable.green_count == result.green_count
    assert all(not item.compatible_families for item in unavailable.candidates)
    wrong_frame = segmentation.model_copy(update={"image_width": 200})
    assert analyze_segmentation_gaps(primary, wrong_frame, service).status == "CALIBRATION_REQUIRED"
    ground.control_points[0].ground_x_m = .1
    ground_path.write_text(ground.model_dump_json())
    stale = analyze_segmentation_gaps(primary, segmentation, service)
    assert stale.status == "CALIBRATION_REQUIRED"
    assert stale.green_count == 0
