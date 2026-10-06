"""Detector evaluation per docs/detector-evaluation-protocol.md."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yaml

MATCH_IOU = 0.5
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


@dataclass(frozen=True)
class Box:
    """Axis-aligned box with a top-left origin, in any consistent unit."""

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class Prediction:
    box: Box
    confidence: float


@dataclass(frozen=True)
class FrameResult:
    true_positives: int
    false_positives: int
    false_negatives: int


@dataclass(frozen=True)
class Metrics:
    frames: int
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float | None
    recall: float | None


def iou(a: Box, b: Box) -> float:
    overlap_width = min(a.x + a.width, b.x + b.width) - max(a.x, b.x)
    overlap_height = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
    if overlap_width <= 0 or overlap_height <= 0:
        return 0.0
    overlap = overlap_width * overlap_height
    return overlap / (a.width * a.height + b.width * b.height - overlap)


def evaluate_frame(predictions: list[Prediction], annotations: list[Box]) -> FrameResult:
    """Match predictions greedily by descending confidence to the unmatched annotation with the highest IoU."""
    unmatched = list(annotations)
    true_positives = 0
    for prediction in sorted(predictions, key=lambda p: p.confidence, reverse=True):
        best = max(unmatched, key=lambda annotation: iou(prediction.box, annotation), default=None)
        if best is not None and iou(prediction.box, best) >= MATCH_IOU:
            unmatched.remove(best)
            true_positives += 1
    return FrameResult(
        true_positives=true_positives,
        false_positives=len(predictions) - true_positives,
        false_negatives=len(unmatched),
    )


def summarize(frames: list[FrameResult]) -> Metrics:
    """Pool counts over frames; a ratio with a zero denominator is undefined rather than 0 or 1."""
    true_positives = sum(frame.true_positives for frame in frames)
    false_positives = sum(frame.false_positives for frame in frames)
    false_negatives = sum(frame.false_negatives for frame in frames)
    predicted = true_positives + false_positives
    annotated = true_positives + false_negatives
    return Metrics(
        frames=len(frames),
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        precision=true_positives / predicted if predicted else None,
        recall=true_positives / annotated if annotated else None,
    )


def read_yolo_labels(path: Path, class_id: int = 0) -> list[Box]:
    """Read a YOLO label file (`class cx cy w h`, normalized) as top-left boxes of the motorcycle class."""
    boxes = []
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        fields = line.split()
        try:
            label_class = int(fields[0])
            centre_x, centre_y, width, height = (float(value) for value in fields[1:])
        except ValueError as exc:
            raise ValueError(f"{path.name}:{line_number}: expected 'class cx cy w h'") from exc
        if not all(0.0 <= value <= 1.0 for value in (centre_x, centre_y, width, height)) or width <= 0 or height <= 0:
            raise ValueError(f"{path.name}:{line_number}: box must be normalized with positive size")
        if label_class == class_id:
            boxes.append(Box(x=centre_x - width / 2, y=centre_y - height / 2, width=width, height=height))
    return boxes


def motorcycle_class_id(classes_file: Path, class_name: str = "motorcycle") -> int:
    """Index of `class_name` (case-insensitive) in Label Studio's classes.txt or a YOLO data.yaml `names`."""
    if classes_file.suffix.lower() in {".yaml", ".yml"}:
        try:
            data = yaml.safe_load(classes_file.read_text())
        except yaml.YAMLError as exc:
            raise ValueError(f"{classes_file.name} is not valid YAML") from exc
        names = data.get("names") if isinstance(data, dict) else None
        if not isinstance(names, (dict, list)):
            raise ValueError(f"{classes_file.name} has no 'names' list")
        names = [names[key] for key in sorted(names)] if isinstance(names, dict) else names
    else:
        names = classes_file.read_text().splitlines()
    wanted = class_name.strip().lower()
    folded = [str(name).strip().lower() for name in names]
    if wanted not in folded:
        raise ValueError(f"{classes_file.name} has no '{class_name}' class")
    return folded.index(wanted)


def evaluate_dataset(
    images_dir: Path, labels_dir: Path, detect: Callable[[bytes], list[Prediction]], class_id: int = 0
) -> Metrics:
    """Evaluate every image against `labels_dir/<stem>.txt`; a missing label file is an error, not an empty frame."""
    for folder in (images_dir, labels_dir):
        if not folder.is_dir():
            raise ValueError(f"not a folder: {folder}")
    images = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        raise ValueError(f"no images ({', '.join(sorted(IMAGE_SUFFIXES))}) in {images_dir}")
    missing = [image.name for image in images if not (labels_dir / f"{image.stem}.txt").is_file()]
    if missing:
        raise ValueError(f"no label file for: {', '.join(missing)}")
    frames = []
    for image in images:
        try:
            predictions = detect(image.read_bytes())
        except ValueError as exc:
            raise ValueError(f"{image.name}: {exc}") from exc
        frames.append(evaluate_frame(predictions, read_yolo_labels(labels_dir / f"{image.stem}.txt", class_id)))
    return summarize(frames)
