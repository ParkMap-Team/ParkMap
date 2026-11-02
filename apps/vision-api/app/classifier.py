"""Local, operator-only model-family experiment. Never publishes parking state."""

import base64
import hashlib
import io
import json
import math
import re
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.operator_auth import require_editor_token
from app.services.cv_service import ModelUnavailableError, cv_service

router = APIRouter(prefix="/api/operator/classifier", tags=["Classifier experiment"], dependencies=[Depends(require_editor_token)])
RUNS = Path(__file__).resolve().parents[3] / "tools/yolo-training/classification/runs"
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
    bbox: dict[str, float]
    crop_url: str
    top3: list[Prediction]


class ClassifierResult(BaseModel):
    model_id: str
    image_width: int
    image_height: int
    preview_url: str
    crops: list[ClassifiedCrop]
    status: Literal["EXPERIMENTAL"] = "EXPERIMENTAL"


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
            result.append(ClassifierModel(id=folder.name, label=f"{folder.name} · {len(meta['dataset']['classes'])} classes",
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
    if checkpoint.get("format_version") != 1 or checkpoint.get("architecture") != "resnet18" or preprocessing["protocol"] != "letterbox_rgb_v1":
        raise ValueError("Unsupported classifier checkpoint")
    classes = checkpoint["classes"]
    if classes != meta["dataset"]["classes"] or not 64 <= checkpoint["image_size"] <= 1024:
        raise ValueError("Invalid classifier class order or image size")
    torch.set_num_threads(2)
    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, len(classes))
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.eval()
    tensor_transform = transforms.Compose([transforms.ToTensor(), transforms.Normalize(preprocessing["mean"], preprocessing["std"])])
    _cache = (stamp, model, classes, checkpoint["image_size"], tuple(preprocessing["padding_rgb"]), tensor_transform)
    return _cache[1:]


def classify(decoded, model_id, mode):
    import torch

    with LOCK:
        model, classes, size, padding, transform = load_model(model_id)
        if mode == "crop":
            boxes = [{"x": 0., "y": 0., "width": 1., "height": 1.}]
        else:
            stream = io.BytesIO()
            decoded.save(stream, "PNG")
            boxes = [d.bbox.model_dump() for d in cv_service.analyze_image(stream.getvalue()).detections]
        if len(boxes) > 300:
            raise HTTPException(422, "Too many detections; use smaller images or cropped motorcycles.")
        crops = []
        for box in boxes:
            left, top = math.floor(box["x"] * decoded.width), math.floor(box["y"] * decoded.height)
            right = min(decoded.width, math.ceil((box["x"] + box["width"]) * decoded.width))
            bottom = min(decoded.height, math.ceil((box["y"] + box["height"]) * decoded.height))
            crop = decoded.crop((max(0, left), max(0, top), right, bottom))
            if min(crop.size) <= 0:
                continue
            padded = ImageOps.pad(crop, (size, size), method=Image.Resampling.BILINEAR, color=padding)
            with torch.inference_mode():
                scores, indices = model(transform(padded).unsqueeze(0)).softmax(1)[0].topk(min(3, len(classes)))
            crops.append(ClassifiedCrop(bbox=box, crop_url=encode_preview(crop), top3=[Prediction(family=classes[i], score=float(s)) for i, s in zip(indices.tolist(), scores.tolist(), strict=True)]))
        return ClassifierResult(model_id=model_id, image_width=decoded.width, image_height=decoded.height,
                                preview_url=encode_preview(decoded), crops=crops)


@router.post("/predict", response_model=ClassifierResult)
async def predict(image: Annotated[UploadFile, File()], model_id: Annotated[str, Form()], response: Response, mode: Literal["detect", "crop"] = Form("detect")):
    response.headers["Cache-Control"] = "no-store"
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
    try:
        return await run_in_threadpool(classify, decoded, model_id, mode)
    except (ValueError, OSError, KeyError, RuntimeError, ModelUnavailableError) as error:
        raise HTTPException(503, "Classifier or YOLO unavailable; verify local trained checkpoints and detector settings.") from error
    finally:
        decoded.close()
