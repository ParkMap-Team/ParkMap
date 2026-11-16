import pytest
from shapely.geometry import box

from app.services.segmentation_experiment_service import SegmentationExperimentResult


def observations(detections):
    return SegmentationExperimentResult(model="test-seg.pt", image_width=1000, image_height=1000,
        processing_time_ms=1, imgsz=960, detections=detections)


def test_horizontal_vehicle_without_a_row_has_reference_clearance_to_nearest_vehicle():
    from app.services.horizontal_vehicle_service import horizontal_vehicle_clearances

    segmentation = observations([
        {"bbox": {"x": .2, "y": .2, "width": .2, "height": .05}, "confidence": .9},
        {"bbox": {"x": .6, "y": .05, "width": .05, "height": .2}, "confidence": .9},
    ])
    result = horizontal_vehicle_clearances(segmentation, [[10, 0, 0], [0, 10, 0], [0, 0, 1]],
        [[.1, 0, 0], [0, .1, 0], [0, 0, 1]], box(0, 0, 10, 10))
    assert len(result) == 1
    vehicle = result[0]
    assert vehicle.detection_id == "detection_1"
    assert vehicle.nearest_detection_id == "detection_2"
    assert vehicle.clearance_m == pytest.approx(1.92)
    assert vehicle.measurement_status == "APPROXIMATE_REFERENCE"
    assert vehicle.line_metric[0].x_m == pytest.approx(4.)
    assert vehicle.line_metric[1].x_m == pytest.approx(5.92)
    assert len(vehicle.polygon_image) == 4
    assert vehicle.display_only is True


def test_horizontal_projection_outside_calibrated_roi_never_reports_metres():
    from app.services.horizontal_vehicle_service import horizontal_vehicle_clearances

    segmentation = observations([
        {"bbox": {"x": .01, "y": .2, "width": .08, "height": .02}, "confidence": .9},
        {"bbox": {"x": .6, "y": .05, "width": .05, "height": .2}, "confidence": .9},
    ])
    result = horizontal_vehicle_clearances(segmentation, [[10, 0, 0], [0, 10, 0], [0, 0, 1]],
        [[.1, 0, 0], [0, .1, 0], [0, 0, 1]], box(0, 0, 10, 10))
    assert result[0].measurement_status == "OUTSIDE_CALIBRATED_ROI"
    assert result[0].clearance_m is None


def test_overlapping_references_report_zero_without_comparing_a_detection_to_itself():
    from app.services.horizontal_vehicle_service import horizontal_vehicle_clearances

    detection = {"bbox": {"x": .2, "y": .2, "width": .2, "height": .05}, "confidence": .9}
    result = horizontal_vehicle_clearances(observations([detection, detection]),
        [[10, 0, 0], [0, 10, 0], [0, 0, 1]], [[.1, 0, 0], [0, .1, 0], [0, 0, 1]], box(0, 0, 10, 10))
    assert [item.nearest_detection_id for item in result] == ["detection_2", "detection_1"]
    assert all(item.clearance_m == 0 for item in result)


def test_image_pixel_ratio_preserves_original_ids_and_suppresses_invalid_projection():
    from app.services.horizontal_vehicle_service import horizontal_vehicle_clearances

    segmentation = observations([
        {"bbox": {"x": .6, "y": .05, "width": .03, "height": .2}, "confidence": .9},
        {"bbox": {"x": .2, "y": .2, "width": .08, "height": .1}, "confidence": .9},
    ])
    segmentation.image_height = 500  # normalized width < height, pixel width > height
    result = horizontal_vehicle_clearances(segmentation, [[10, 0, 0], [0, 10, 0], [0, 0, 1]],
        [[.1, 0, 0], [0, .1, 0], [0, 0, 1]], box(0, 0, 10, 10))
    assert len(result) == 1
    assert result[0].detection_id == "detection_2"
    assert result[0].pixel_aspect_ratio == pytest.approx(1.6)
    assert result[0].nearest_detection_id == "detection_1"
    failed = horizontal_vehicle_clearances(segmentation, [[10, 0, 0], [0, 10, 0], [0, 0, 1]],
        [[0, 0, 0]]*3, box(0, 0, 10, 10))
    assert failed[0].measurement_status == "PROJECTION_UNAVAILABLE"
    assert failed[0].clearance_m is None


def test_ambiguous_orientations_are_reported_as_excluded_neighbors_not_guessed():
    from app.services.horizontal_vehicle_service import horizontal_vehicle_clearances

    segmentation = observations([
        {"bbox": {"x": .2, "y": .2, "width": .2, "height": .05}, "confidence": .9},
        {"bbox": {"x": .4, "y": .2, "width": .1, "height": .1}, "confidence": .9},
    ])
    result = horizontal_vehicle_clearances(segmentation, [[10, 0, 0], [0, 10, 0], [0, 0, 1]],
        [[.1, 0, 0], [0, .1, 0], [0, 0, 1]], box(0, 0, 10, 10))
    assert result[0].measurement_status == "NO_COMPARABLE_NEIGHBOR"
    assert result[0].excluded_neighbor_count == 1
    assert result[0].clearance_m is None
