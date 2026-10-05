"""Detector evaluation per docs/detector-evaluation-protocol.md."""

from dataclasses import dataclass
from pathlib import Path

MATCH_IOU = 0.5


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
