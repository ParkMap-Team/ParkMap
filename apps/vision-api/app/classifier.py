"""Local, operator-only model-family experiment. Never publishes parking state."""

import base64
import hashlib
import io
import json
import math
import re
from pathlib import Path
from threading import Lock
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.models import DetectionResponse
from app.operator_auth import require_editor_token
from app.services.cv_service import ModelUnavailableError, cv_service
from app.services.motorcycle_reference_sizes import (
    ResolvedReferenceSize,
    load_rules,
    reference_size,
)
from app.services.parking_analysis_service import (
    ParkingCalibrationUnavailableError,
    parking_analysis_service,
)
from app.services.segmentation_experiment_service import (
    SegmentationExperimentResult,
    segmentation_experiment_service,
)
from app.services.segmentation_gap_service import (
    SegmentationGapResult,
    analyze_segmentation_gaps,
)

router = APIRouter(prefix="/api/operator/classifier", tags=["Classifier experiment"], dependencies=[Depends(require_editor_token)])
API_ROOT = Path(__file__).resolve().parent.parent
RUNS = API_ROOT.parent.parent / "tools/yolo-training/classification/runs"
LOCK = Lock()
_cache = None


class ClassifierModel(BaseModel):
    id: str
    label: str
    epoch: int
    classes: int
    val_top1: float


class Prediction(BaseModel):
    family: str
    score: float


class ClassifiedCrop(BaseModel):
    detection_index: int = 0
    bbox: dict[str, float]
    crop_url: str
    top3: list[Prediction]
    reference_size: ResolvedReferenceSize | None = None


class ClassifierResult(BaseModel):
    model_id: str
    image_width: int
    image_height: int
    preview_url: str
    crops: list[ClassifiedCrop]
    status: Literal["EXPERIMENTAL"] = "EXPERIMENTAL"


class ReferenceSizeExperiment(BaseModel):
    status: Literal["EXPERIMENTAL"] = "EXPERIMENTAL"
    config_file: str = "config/motorcycle_reference_sizes.json"
    sizes: list[ResolvedReferenceSize]
    parking_analysis: dict[str, Any] | None = None


class ParkingClassifierResult(BaseModel):
    detection: DetectionResponse
    classification: ClassifierResult | None = None
    classification_error: str | None = None
    parking_error: str | None = None
    reference_size_error: str | None = None
    reference_size_experiment: ReferenceSizeExperiment | None = None
    segmentation: SegmentationExperimentResult | None = None
    segmentation_error: str | None = None
    segmentation_gaps: SegmentationGapResult | None = None


def available_models():
    result = []
    for folder in sorted(RUNS.glob("train-*")):
        if folder.is_symlink() or not re.fullmatch(r"train-[A-Za-z0-9-]+", folder.name):
            continue
        try:
            meta = json.loads((folder / "run.json").read_text(encoding="utf-8"))
            metrics = json.loads((folder / "val/metrics.json").read_text(encoding="utf-8"))
            if meta.get("run_state") != "complete" or not (folder / "best.pt").is_file():
                continue
            architecture = meta.get("options", {}).get("architecture", "resnet18")
            if architecture not in {"resnet18", "efficientnet_b0", "yolo11n_cls"}:
                continue
            result.append(ClassifierModel(id=folder.name, label=f"{architecture} · {folder.name} · {len(meta['dataset']['classes'])} classes",
                                          epoch=meta["best_epoch"], classes=len(meta["dataset"]["classes"]), val_top1=metrics["top1"]))
        except (OSError, ValueError, KeyError):
            continue
    return result


@router.get("/models", response_model=list[ClassifierModel])
def list_models(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return available_models()


def encode_preview(image):
    preview = image.copy()
    preview.thumbnail((1200, 1200))
    stream = io.BytesIO()
    preview.save(stream, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def load_model(model_id):
    global _cache
    if model_id not in {item.id for item in available_models()}:
        raise HTTPException(404, "Classifier model not found or training is incomplete.")
    path = RUNS / model_id / "best.pt"
    if path.is_symlink() or not path.resolve().is_relative_to(RUNS.resolve()):
        raise HTTPException(404, "Classifier model is unavailable.")
    stamp = (model_id, path.stat().st_mtime_ns, path.stat().st_size)
    if _cache and _cache[0] == stamp:
        return _cache[1:]
    import torch
    from torchvision import models, transforms

    meta = json.loads((path.parent / "run.json").read_text(encoding="utf-8"))
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != meta["best_checkpoint_sha256"]:
            raise ValueError("Checkpoint hash mismatch")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    preprocessing = checkpoint["preprocessing"]
    architecture = checkpoint.get("architecture")
    if checkpoint.get("format_version") != 1 or architecture not in {"resnet18", "efficientnet_b0", "yolo11n_cls"} or preprocessing["protocol"] != "letterbox_rgb_v1":
        raise ValueError("Unsupported classifier checkpoint")
    if architecture != meta.get("options", {}).get("architecture", "resnet18"):
        raise ValueError("Checkpoint architecture does not match run metadata")
    classes = checkpoint["classes"]
    if classes != meta["dataset"]["classes"] or not 64 <= checkpoint["image_size"] <= 1024:
        raise ValueError("Invalid classifier class order or image size")
    torch.set_num_threads(2)
    state_dict = checkpoint["state_dict"]
    if architecture == "yolo11n_cls":
        from ultralytics.nn.tasks import ClassificationModel

        model = ClassificationModel("yolo11n-cls.yaml", nc=1000, verbose=False)
        head = model.model[-1]
        head.linear = torch.nn.Linear(head.linear.in_features, len(classes))
        # The training adapter wraps the same Ultralytics network under `network`.
        if not all(key.startswith("network.") for key in state_dict):
            raise ValueError("Invalid YOLO classifier state dict")
        state_dict = {key.removeprefix("network."): value for key, value in state_dict.items()}
    elif architecture == "resnet18":
        model = models.resnet18(weights=None)
        model.fc = torch.nn.Linear(model.fc.in_features, len(classes))
    else:
        model = models.efficientnet_b0(weights=None)
        model.classifier[-1] = torch.nn.Linear(model.classifier[-1].in_features, len(classes))
    model.load_state_dict(state_dict, strict=True)
    model.eval()
    tensor_transform = transforms.Compose([transforms.ToTensor(), transforms.Normalize(preprocessing["mean"], preprocessing["std"])])
    _cache = (stamp, model, classes, checkpoint["image_size"], tuple(preprocessing["padding_rgb"]), tensor_transform)
    return _cache[1:]


def classify(decoded, model_id, mode, boxes=None):
    import torch

    with LOCK:
        model, classes, size, padding, transform = load_model(model_id)
        if boxes is not None:
            pass  # Boxes came from this request's detector, never from the browser.
        elif mode == "crop":
            boxes = [{"x": 0., "y": 0., "width": 1., "height": 1.}]
        else:
            stream = io.BytesIO()
            decoded.save(stream, "PNG")
            boxes = [d.bbox.model_dump() for d in cv_service.analyze_image(stream.getvalue()).detections]
        if len(boxes) > 300:
            raise HTTPException(422, "Too many detections; use smaller images or cropped motorcycles.")
        crops = []
        for detection_index, box in enumerate(boxes):
            left, top = math.floor(box["x"] * decoded.width), math.floor(box["y"] * decoded.height)
            right = min(decoded.width, math.ceil((box["x"] + box["width"]) * decoded.width))
            bottom = min(decoded.height, math.ceil((box["y"] + box["height"]) * decoded.height))
            crop = decoded.crop((max(0, left), max(0, top), right, bottom))
            if min(crop.size) <= 0:
                continue
            padded = ImageOps.pad(crop, (size, size), method=Image.Resampling.BILINEAR, color=padding)
            with torch.inference_mode():
                output = model(transform(padded).unsqueeze(0))
                # YOLO returns (probabilities, logits) in eval mode; use logits so
                # softmax is applied once, matching the saved training evaluation.
                logits = output[1] if isinstance(output, tuple) else output
                scores, indices = logits.softmax(1)[0].topk(min(3, len(classes)))
            crops.append(ClassifiedCrop(detection_index=detection_index, bbox=box, crop_url=encode_preview(crop), top3=[Prediction(family=classes[i], score=float(s)) for i, s in zip(indices.tolist(), scores.tolist(), strict=True)]))
        return ClassifierResult(model_id=model_id, image_width=decoded.width, image_height=decoded.height,
                                preview_url=encode_preview(decoded), crops=crops)


async def read_image(image: UploadFile):
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Choose JPEG, PNG or WebP.")
    try:
        raw = await image.read(25 * 1024 * 1024 + 1)
    finally:
        await image.close()
    if not raw or len(raw) > 25 * 1024 * 1024:
        raise HTTPException(413, "Image is empty or exceeds 25 MB.")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 40_000_000:
                raise HTTPException(413, "Image exceeds 40 megapixels.")
            if source.format != {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[image.content_type]:
                raise ValueError("Format mismatch")
            source.load()
            decoded = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(400, "Invalid image.") from error
    return decoded


@router.post("/predict", response_model=ClassifierResult)
async def predict(image: Annotated[UploadFile, File()], model_id: Annotated[str, Form()], response: Response, mode: Literal["detect", "crop"] = Form("detect")):
    response.headers["Cache-Control"] = "no-store"
    decoded = await read_image(image)
    try:
        return await run_in_threadpool(classify, decoded, model_id, mode)
    except (ValueError, OSError, KeyError, RuntimeError, ModelUnavailableError) as error:
        raise HTTPException(503, "Classifier or YOLO unavailable; verify local trained checkpoints and detector settings.") from error
    finally:
        decoded.close()


@router.post("/analyze", response_model=ParkingClassifierResult)
async def analyze(image: Annotated[UploadFile, File()], response: Response, model_id: str = Form(""), include_parking: bool = Form(True), include_segmentation: bool = Form(False), include_segmentation_gaps: bool = Form(False)):
    response.headers["Cache-Control"] = "no-store"
    decoded = await read_image(image)
    try:
        stream = io.BytesIO()
        decoded.save(stream, "PNG")
        try:
            detection = await run_in_threadpool(cv_service.analyze_image, stream.getvalue())
        except ModelUnavailableError as error:
            raise HTTPException(503, "YOLO unavailable; verify local detector settings.") from error
        result = ParkingClassifierResult(detection=detection)
        if include_parking:
            try:
                detection.parking_analysis = await run_in_threadpool(parking_analysis_service.analyze, detection)
            except ParkingCalibrationUnavailableError:
                result.parking_error = "Parking calibration is unavailable; detection and classification remain usable."
        if model_id:
            try:
                result.classification = await run_in_threadpool(classify, decoded, model_id, "detect", [d.bbox.model_dump() for d in detection.detections])
            except (HTTPException, ValueError, OSError, KeyError, RuntimeError, ModelUnavailableError):
                result.classification_error = "Classifier unavailable; choose a completed local model and retry Analyze."
        else:
            result.classification_error = "No classifier selected; choose a completed local model and retry Analyze."
        if result.classification is not None:
            try:
                rules = load_rules()
                sizes = [reference_size(rules, None, None) for _ in detection.detections]
                for crop in result.classification.crops:
                    top = crop.top3[0] if crop.top3 else None
                    size = reference_size(rules, top.family if top else None, top.score if top else None)
                    crop.reference_size = size
                    sizes[crop.detection_index] = size
                experiment = ReferenceSizeExperiment(sizes=sizes)
                if include_parking and detection.parking_analysis is not None:
                    experiment.parking_analysis = await run_in_threadpool(parking_analysis_service.analyze, detection, reference_sizes=sizes)
                result.reference_size_experiment = experiment
            except (OSError, ValueError, ParkingCalibrationUnavailableError):
                result.reference_size_error = "Reference-size experiment unavailable; check config/motorcycle_reference_sizes.json. Standard analysis remains available."
        if include_segmentation or include_segmentation_gaps:
            try:
                result.segmentation = await run_in_threadpool(segmentation_experiment_service.analyze_image, stream.getvalue())
                result.segmentation.preview_url = encode_preview(decoded)
            except (ModelUnavailableError, OSError, ValueError, RuntimeError):
                result.segmentation_error = "Segmentation unavailable. Install models/yolo11m-seg.pt with python scripts/download_segmentation_weights.py; the standard analysis remains available."
        if include_segmentation_gaps:
            if result.segmentation is None:
                result.segmentation_gaps = SegmentationGapResult(status="UNKNOWN", evaluation_mode="WIDTH_ONLY", reasons=["SEGMENTATION_UNAVAILABLE"])
            else:
                references = result.reference_size_experiment.sizes if result.reference_size_experiment else None
                result.segmentation_gaps = await run_in_threadpool(analyze_segmentation_gaps, detection, result.segmentation, reference_sizes=references)
        return result
    finally:
        decoded.close()
