"""Settings for the operator Parking detection and classification pipeline."""

from pathlib import Path
from typing import Literal

_API_ROOT = Path(__file__).resolve().parents[1]
_TRAINING_ROOT = _API_ROOT.parent.parent / "tools/yolo-training"
_TRAINING_RUNS = _TRAINING_ROOT / "detection/runs"


def classifier_runs(api_root: Path) -> Path:
    return api_root.parent.parent / "tools/yolo-training/classification/runs"


CLASSIFIER_RUNS = classifier_runs(_API_ROOT)
BOX_WEIGHTS = _TRAINING_RUNS / "yolo26n/round-10_2026-11-09_10-04/weights/best.pt"
SEGMENTATION_WEIGHTS = _API_ROOT / "models/yolo26n-seg_round-08_best.pt"
SEGMENTATION_MOTORCYCLE_CLASS_ID = 0
MODEL_ID = "train-20261112-005242-convnext-ft-6ea9a9"

DetectionMode = Literal["wide", "near"]
DEFAULT_FRAME_MODE: DetectionMode = "near"
NEAR_FRAME_IMGSZ = 960
DEFAULT_CLEARANCE_MARGIN_M = 0.0
MAX_CLEARANCE_MARGIN_M = 1.0
CROP_PADDING_RATIO = 0.05
MAX_SELECTED_BOXES = 60
MAX_SELECTION_JSON_LENGTH = 16_000
BOX_BOUNDARY_TOLERANCE = 1e-9
TOP_PREDICTIONS = 3
MIN_SCORE = 0.60
SELECTED_CROP_PREVIEW_SIZE = (320, 320)

UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
MAX_OPERATOR_UPLOAD_MIB = 25
MAX_OPERATOR_UPLOAD_BYTES = MAX_OPERATOR_UPLOAD_MIB * UPLOAD_READ_CHUNK_BYTES
MAX_VIDEO_DURATION_SECONDS = 30
MAX_VIDEO_FRAME_PIXELS = 8_400_000
MAX_SOURCE_FPS = 120

MAX_TRACK_DETECTIONS = 60
MAX_TRACKS = 300
TRACK_BUFFER_SECONDS = 2
MIN_OBSERVATIONS = 3
TRACK_CROP_PREVIEW_SIZE = (240, 240)
VIDEO_FORMATS = {"video/mp4": ".mp4", "video/webm": ".webm"}
