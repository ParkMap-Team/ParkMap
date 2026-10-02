"""Version a published analysis by the exact weights and inference configuration."""

import hashlib
import json
import math
from pathlib import Path


def analysis_version_for_model(
    analysis_revision: str,
    weights_path: Path,
    *,
    imgsz: int,
    confidence: float,
    nms_iou: float,
    device: str,
) -> str:
    """Return a compact, deterministic fingerprint without exposing the weights."""
    if not analysis_revision or imgsz <= 0 or not device:
        raise ValueError(
            "Analysis revision, image size, and device must be configured."
        )
    if not all(
        math.isfinite(value) and 0 <= value <= 1 for value in (confidence, nms_iou)
    ):
        raise ValueError(
            "Confidence and NMS IoU must be finite values between 0 and 1."
        )

    weights_digest = hashlib.sha256()
    with weights_path.open("rb") as weights:
        for chunk in iter(lambda: weights.read(1024 * 1024), b""):
            weights_digest.update(chunk)
    digest = hashlib.sha256(weights_digest.digest())
    digest.update(
        json.dumps(
            {
                "imgsz": imgsz,
                "confidence": confidence,
                "nms_iou": nms_iou,
                "device": device,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    version = f"{analysis_revision}+model-{digest.hexdigest()[:16]}"
    if len(version) > 64:
        raise ValueError(
            "Fingerprinted analysis_version exceeds the 64-character contract."
        )
    return version
