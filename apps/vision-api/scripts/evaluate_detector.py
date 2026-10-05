"""Evaluate the configured detector on labelled images (docs/detector-evaluation-protocol.md).

    python scripts/evaluate_detector.py IMAGES_DIR LABELS_DIR

Labels are YOLO text files named after each image. The model and its settings come from PARKMAP_MODEL_*.
Prints JSON with the weights' SHA-256, inference settings, and pooled counts, precision, and recall.
"""

import argparse
import hashlib
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models import DetectionResponse  # noqa: E402
from app.services.detection_evaluation import MATCH_IOU, Box, Prediction, evaluate_dataset  # noqa: E402


def predictions_from_response(response: DetectionResponse) -> list[Prediction]:
    return [
        Prediction(
            box=Box(x=detection.bbox.x, y=detection.bbox.y, width=detection.bbox.width, height=detection.bbox.height),
            confidence=detection.confidence,
        )
        for detection in response.detections
    ]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("images_dir", type=Path)
    parser.add_argument("labels_dir", type=Path)
    args = parser.parse_args()

    from app.services.cv_service import ModelUnavailableError, cv_service

    if not cv_service.is_configured:
        print(f"model weights not found: {cv_service.model_path}", file=sys.stderr)
        return 1
    try:
        metrics = evaluate_dataset(
            args.images_dir,
            args.labels_dir,
            lambda image: predictions_from_response(cv_service.analyze_image(image)),
        )
    except (ModelUnavailableError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1

    report = {
        "weights": {"file": cv_service.model_path.name, "sha256": sha256(cv_service.model_path)},
        "inference": {
            "imgsz": cv_service.imgsz,
            "confidence": cv_service.confidence_threshold,
            "nms_iou": cv_service.nms_iou,
            "device": cv_service.device,
        },
        "match_iou": MATCH_IOU,
        "metrics": asdict(metrics),
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
