import pytest

from app.services.detection_evaluation import (
    Box,
    FrameResult,
    Prediction,
    evaluate_dataset,
    evaluate_frame,
    motorcycle_class_id,
    read_yolo_labels,
    summarize,
)


def test_prediction_on_annotated_motorcycle_is_true_positive():
    annotation = Box(x=0.1, y=0.1, width=0.2, height=0.2)

    result = evaluate_frame([Prediction(box=annotation, confidence=0.9)], [annotation])

    assert (result.true_positives, result.false_positives, result.false_negatives) == (1, 0, 0)


def test_match_requires_iou_of_at_least_one_half():
    annotation = Box(x=0, y=0, width=2, height=1)
    at_threshold = Prediction(box=Box(x=0, y=0, width=1, height=1), confidence=0.9)  # IoU 1/2
    below_threshold = Prediction(box=Box(x=0, y=0, width=0.99, height=1), confidence=0.9)  # IoU 0.495

    matched = evaluate_frame([at_threshold], [annotation])
    missed = evaluate_frame([below_threshold], [annotation])

    assert (matched.true_positives, matched.false_positives, matched.false_negatives) == (1, 0, 0)
    assert (missed.true_positives, missed.false_positives, missed.false_negatives) == (0, 1, 1)


def test_higher_confidence_prediction_claims_the_annotation_first():
    left = Box(x=0, y=0, width=1, height=1)
    right = Box(x=0.4, y=0, width=1, height=1)
    confident = Prediction(box=Box(x=0.15, y=0, width=1, height=1), confidence=0.9)  # IoU 0.74 left, 0.60 right
    less_confident = Prediction(box=Box(x=-0.2, y=0, width=1, height=1), confidence=0.5)  # IoU 0.67 left, 0.25 right

    result = evaluate_frame([less_confident, confident], [left, right])

    # The confident prediction takes left, so the other one cannot match right.
    assert (result.true_positives, result.false_positives, result.false_negatives) == (1, 1, 1)


def test_duplicate_predictions_on_one_motorcycle_count_one_false_positive():
    annotation = Box(x=0, y=0, width=1, height=1)

    result = evaluate_frame(
        [Prediction(box=annotation, confidence=0.5), Prediction(box=annotation, confidence=0.9)], [annotation]
    )

    assert (result.true_positives, result.false_positives, result.false_negatives) == (1, 1, 0)


def test_prediction_takes_the_unmatched_annotation_with_highest_iou():
    left = Box(x=0, y=0, width=1, height=1)
    right = Box(x=0.5, y=0, width=1, height=1)
    prediction_near_right = Prediction(box=Box(x=0.3, y=0, width=1, height=1), confidence=0.9)  # IoU 0.54 left, 0.67 right
    prediction_on_left = Prediction(box=left, confidence=0.6)  # IoU 0.33 right

    result = evaluate_frame([prediction_near_right, prediction_on_left], [left, right])

    assert (result.true_positives, result.false_positives, result.false_negatives) == (2, 0, 0)


def test_precision_and_recall_pool_counts_across_frames():
    frames = [
        FrameResult(true_positives=3, false_positives=1, false_negatives=0),
        FrameResult(true_positives=1, false_positives=0, false_negatives=4),
    ]

    metrics = summarize(frames)

    assert (metrics.frames, metrics.true_positives, metrics.false_positives, metrics.false_negatives) == (2, 4, 1, 4)
    assert metrics.precision == 4 / 5
    assert metrics.recall == 4 / 8


def test_precision_and_recall_are_undefined_without_predictions_or_annotations():
    metrics = summarize([FrameResult(true_positives=0, false_positives=0, false_negatives=0)])

    assert metrics.precision is None
    assert metrics.recall is None


def test_yolo_label_centre_box_becomes_top_left_box(tmp_path):
    label = tmp_path / "frame.txt"
    label.write_text("0 0.5 0.4 0.2 0.1\n")

    [box] = read_yolo_labels(label)

    assert (box.x, box.y, box.width, box.height) == pytest.approx((0.4, 0.35, 0.2, 0.1))


def test_yolo_labels_keep_only_the_motorcycle_class_and_allow_empty_frames(tmp_path):
    mixed = tmp_path / "mixed.txt"
    mixed.write_text("1 0.5 0.5 0.2 0.2\n\n0 0.5 0.5 0.2 0.2\n")
    empty = tmp_path / "empty.txt"
    empty.write_text("")

    assert len(read_yolo_labels(mixed)) == 1
    assert read_yolo_labels(empty) == []


@pytest.mark.parametrize(
    "line",
    ["0 0.5 0.5 0.2", "0 0.5 0.5 0.2 0.2 0.9", "x 0.5 0.5 0.2 0.2", "0 0.5 0.5 1.2 0.2", "0 0.5 0.5 0 0.2"],
)
def test_malformed_yolo_label_is_rejected(tmp_path, line):
    label = tmp_path / "frame.txt"
    label.write_text(line + "\n")

    with pytest.raises(ValueError, match="frame.txt:1"):
        read_yolo_labels(label)


def _dataset(tmp_path, labels: dict[str, str]):
    images, label_dir = tmp_path / "images", tmp_path / "labels"
    images.mkdir()
    label_dir.mkdir()
    for stem, text in labels.items():
        (images / f"{stem}.jpg").write_bytes(stem.encode())
        if text is not None:
            (label_dir / f"{stem}.txt").write_text(text)
    return images, label_dir


def test_dataset_evaluation_pairs_each_image_with_its_label_file(tmp_path):
    images, labels = _dataset(tmp_path, {"hit": "0 0.5 0.5 0.2 0.2\n", "miss": "0 0.5 0.5 0.2 0.2\n"})
    on_motorcycle = Prediction(box=Box(x=0.4, y=0.4, width=0.2, height=0.2), confidence=0.9)

    metrics = evaluate_dataset(images, labels, lambda image: [on_motorcycle] if image == b"hit" else [])

    assert (metrics.frames, metrics.true_positives, metrics.false_positives, metrics.false_negatives) == (2, 1, 0, 1)


def test_image_without_label_file_is_rejected_rather_than_counted_empty(tmp_path):
    images, labels = _dataset(tmp_path, {"labelled": "", "unlabelled": None})

    with pytest.raises(ValueError, match="unlabelled"):
        evaluate_dataset(images, labels, lambda image: [])


def test_motorcycle_class_id_comes_from_the_exported_class_list(tmp_path):
    classes = tmp_path / "classes.txt"
    classes.write_text("bicycle\nmotorcycle\n")

    assert motorcycle_class_id(classes) == 1


def test_class_list_without_motorcycle_is_rejected(tmp_path):
    classes = tmp_path / "classes.txt"
    classes.write_text("bicycle\ncar\n")

    with pytest.raises(ValueError, match="motorcycle"):
        motorcycle_class_id(classes)


def test_dataset_evaluation_uses_the_given_motorcycle_class(tmp_path):
    images, labels = _dataset(tmp_path, {"frame": "1 0.5 0.5 0.2 0.2\n1 0.2 0.2 0.1 0.1\n0 0.1 0.1 0.1 0.1\n"})

    metrics = evaluate_dataset(images, labels, lambda image: [], class_id=1)

    assert metrics.false_negatives == 2


def test_dataset_without_images_is_rejected(tmp_path):
    images, labels = _dataset(tmp_path, {})

    with pytest.raises(ValueError, match="no images"):
        evaluate_dataset(images, labels, lambda image: [])


def test_missing_dataset_folder_is_rejected_with_its_path(tmp_path):
    images, labels = _dataset(tmp_path, {"frame": ""})

    with pytest.raises(ValueError, match="not a folder"):
        evaluate_dataset(tmp_path / "absent", labels, lambda image: [])
    with pytest.raises(ValueError, match="not a folder"):
        evaluate_dataset(images, tmp_path / "absent", lambda image: [])


def test_unreadable_image_is_reported_by_name(tmp_path):
    images, labels = _dataset(tmp_path, {"broken": ""})

    def reject(image):
        raise ValueError("The uploaded file is not a valid supported image.")

    with pytest.raises(ValueError, match="broken.jpg"):
        evaluate_dataset(images, labels, reject)


def test_motorcycle_class_id_reads_roboflow_data_yaml_case_insensitively(tmp_path):
    data = tmp_path / "data.yaml"
    data.write_text("train: ../train/images\nnc: 2\nnames: ['car', 'Motorcycle']\n")

    assert motorcycle_class_id(data) == 1


def test_motorcycle_class_id_reads_ultralytics_name_mapping(tmp_path):
    data = tmp_path / "data.yaml"
    data.write_text("names:\n  0: car\n  1: motorcycle\n")

    assert motorcycle_class_id(data) == 1


def test_dataset_class_name_can_differ_from_motorcycle(tmp_path):
    data = tmp_path / "data.yaml"
    data.write_text("names: ['Motor']\n")

    assert motorcycle_class_id(data, class_name="motor") == 0
