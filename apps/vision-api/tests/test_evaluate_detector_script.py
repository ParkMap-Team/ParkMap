from app.models import Detection, DetectionAnalysisModel, DetectionBBox, DetectionInference, DetectionResponse
from app.services.detection_evaluation import Box, Prediction
from scripts.evaluate_detector import default_classes_file, predictions_from_response


def test_detector_response_becomes_normalized_predictions():
    response = DetectionResponse(
        image_width=1920,
        image_height=1080,
        model=DetectionAnalysisModel(name="ParkMap YOLO"),
        inference=DetectionInference(imgsz=960, confidence_threshold=0.25, nms_iou=0.5, processing_time_ms=1.0),
        detections=[
            Detection(
                class_id=0,
                class_name="motorcycle",
                confidence=0.8,
                bbox=DetectionBBox(x=0.1, y=0.2, width=0.3, height=0.4),
            )
        ],
    )

    assert predictions_from_response(response) == [
        Prediction(box=Box(x=0.1, y=0.2, width=0.3, height=0.4), confidence=0.8)
    ]


def test_class_list_is_found_for_label_studio_and_roboflow_exports(tmp_path):
    label_studio, roboflow = tmp_path / "ls", tmp_path / "rf"
    for export, name in ((label_studio, "classes.txt"), (roboflow, "data.yaml")):
        (export / "labels").mkdir(parents=True)
        (export / name).write_text("motorcycle\n")

    assert default_classes_file(label_studio / "labels") == label_studio / "classes.txt"
    assert default_classes_file(roboflow / "labels") == roboflow / "data.yaml"
