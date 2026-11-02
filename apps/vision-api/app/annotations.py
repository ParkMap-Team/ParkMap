"""Private local annotation workspace and explicit immutable YOLO dataset exports."""

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import uuid
import warnings
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi import Path as ApiPath
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

from app.operator_auth import require_editor_token
from app.services.cv_service import ModelUnavailableError, cv_service

router = APIRouter(prefix="/api/operator/annotations", tags=["Annotations"], dependencies=[Depends(require_editor_token)])
Dataset = ApiPath(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")
SampleId = ApiPath(pattern=r"^[a-f0-9]{64}$")
MAX_BYTES = 25 * 1024 * 1024


class LabelPoint(BaseModel):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)


class LabelBox(LabelPoint):
    width: float = Field(gt=0, le=1, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def inside_image(self):
        if self.x + self.width > 1 + 1e-8 or self.y + self.height > 1 + 1e-8:
            raise ValueError("Bounding box must remain inside the image")
        return self


class MotorcycleLabel(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9-]+$")
    bbox: LabelBox
    ground_point: LabelPoint | None = None
    occluded: bool


class AnnotationWrite(BaseModel):
    expected_revision: int = Field(ge=0)
    split: Literal["unassigned", "train", "val", "test"] = "unassigned"
    reviewed: bool = False
    annotations: list[MotorcycleLabel] = Field(max_length=1000)

    @model_validator(mode="after")
    def valid_review(self):
        if len({item.id for item in self.annotations}) != len(self.annotations):
            raise ValueError("Annotation IDs must be unique")
        return self


class AnnotationSample(BaseModel):
    id: str
    filename: str
    width: int
    height: int
    revision: int
    session: str
    split: Literal["unassigned", "train", "val", "test"]
    reviewed: bool
    annotations: list[MotorcycleLabel]


def capture_group(filename: str) -> str:
    """Group a capture day conservatively; never treat each unique time as an independent session."""
    name = Path(filename).stem
    match = re.match(r"^(?:IMG[_ -]?)?((?:19|20)\d{2})[-_]?(\d{2})[-_]?(\d{2})", name, re.IGNORECASE)
    if match:
        year, month, day = map(int, match.groups())
    else:
        match = re.match(r"^(\d{2})[-_](\d{2})[-_]((?:19|20)\d{2})", name)
        if not match:
            return "undated"
        day, month, year = map(int, match.groups())
    try:
        return "date:" + date(year, month, day).isoformat()
    except ValueError:
        return "undated"


def decode_sample(payload: str) -> AnnotationSample:
    sample = AnnotationSample.model_validate_json(payload)
    # Existing labels remain intact; grouping is recalculated from the stored original filename.
    return sample.model_copy(update={"session": capture_group(sample.filename)})


def workspace(dataset: str) -> Path:
    # Environment is server-owned; there is no browser-supplied filesystem path.
    default = Path(__file__).resolve().parents[3] / "tools/yolo-training/datasets"
    root = Path(os.getenv("PARKMAP_DATASET_ROOT", str(default))).resolve()
    folder = (root / dataset).resolve()
    if folder.parent != root:
        raise HTTPException(400, "Invalid dataset directory")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


@contextmanager
def database(folder: Path):
    db = sqlite3.connect(folder / "annotations.sqlite3", timeout=10)
    try:
        db.row_factory = sqlite3.Row
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            yield db
    finally:
        db.close()


def read_sample(db, sample_id: str) -> AnnotationSample:
    row = db.execute("SELECT payload FROM samples WHERE id=?", (sample_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Image not found")
    return decode_sample(row["payload"])


@router.get("/{dataset}", response_model=list[AnnotationSample])
def list_samples(dataset: str = Dataset):
    with database(workspace(dataset)) as db:
        return [decode_sample(row["payload"]) for row in db.execute("SELECT payload FROM samples ORDER BY id")]


@router.post("/{dataset}/images", response_model=AnnotationSample)
async def upload_image(image: Annotated[UploadFile, File()], dataset: str = Dataset):
    formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    if image.content_type not in formats:
        raise HTTPException(415, "Use JPEG, PNG or WebP")
    data = await image.read(MAX_BYTES + 1)
    await image.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "Image must be non-empty and at most 25 MB")
    return await run_in_threadpool(store_image, dataset, data, formats[image.content_type], image.filename)


def store_image(dataset: str, data: bytes, expected_format: str, filename: str | None) -> AnnotationSample:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as decoded:
                if decoded.format != expected_format or decoded.width * decoded.height > 40_000_000:
                    raise ValueError("Invalid image format or dimensions")
                normalized = ImageOps.exif_transpose(decoded).convert("RGB")
                normalized.load()
            output = io.BytesIO()
            normalized.save(output, format="PNG")  # Strip EXIF; saved image and annotation canvas share orientation.
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(422, "Image cannot be decoded safely") from error
    canonical = output.getvalue()
    if len(canonical) > MAX_BYTES:
        raise HTTPException(413, "Normalized image exceeds 25 MB; use a smaller image")
    sample_id = hashlib.sha256(canonical).hexdigest()
    folder = workspace(dataset)
    with database(folder) as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT id FROM samples WHERE id=?", (sample_id,)).fetchone()
        if existing:
            return read_sample(db, sample_id)
        if db.execute("SELECT count(*) FROM samples").fetchone()[0] >= 2000:
            raise HTTPException(422, "Use at most 2000 images per workspace")
        (folder / "images").mkdir(exist_ok=True)
        (folder / "images" / f"{sample_id}.png").write_bytes(canonical)
        sample = AnnotationSample(id=sample_id, filename=(filename or "image").replace("\\", "/").split("/")[-1][:180],
            width=normalized.width, height=normalized.height, revision=0, session=capture_group(filename or "image"), split="unassigned", reviewed=False, annotations=[])
        db.execute("INSERT INTO samples VALUES (?,?)", (sample_id, sample.model_dump_json()))
        return sample


@router.get("/{dataset}/images/{sample_id}")
def get_image(dataset: str = Dataset, sample_id: str = SampleId):
    folder = workspace(dataset)
    with database(folder) as db:
        read_sample(db, sample_id)
    return FileResponse(folder / "images" / f"{sample_id}.png", media_type="image/png", headers={"Cache-Control": "no-store"})


@router.put("/{dataset}/samples/{sample_id}", response_model=AnnotationSample)
def save_sample(request: AnnotationWrite, dataset: str = Dataset, sample_id: str = SampleId):
    with database(workspace(dataset)) as db:
        db.execute("BEGIN IMMEDIATE")
        current = read_sample(db, sample_id)
        if current.revision != request.expected_revision:
            raise HTTPException(409, "Labels changed in another tab. Reload before saving")
        if request.split != "unassigned":
            for row in db.execute("SELECT payload FROM samples WHERE id != ?", (sample_id,)):
                other = decode_sample(row["payload"])
                if other.session == current.session and other.split not in ("unassigned", request.split):
                    raise HTTPException(422, "Images from the same filename date must stay in one split; undated images also form one group")
        updated = AnnotationSample.model_validate({**current.model_dump(), **request.model_dump(exclude={"expected_revision"}), "revision": current.revision + 1})
        db.execute("UPDATE samples SET payload=? WHERE id=?", (updated.model_dump_json(), sample_id))
        return updated


@router.post("/{dataset}/samples/{sample_id}/detect", response_model=list[MotorcycleLabel])
async def propose_boxes(dataset: str = Dataset, sample_id: str = SampleId):
    folder = workspace(dataset)
    with database(folder) as db:
        read_sample(db, sample_id)
    try:
        detection = await run_in_threadpool(cv_service.analyze_image, (folder / "images" / f"{sample_id}.png").read_bytes())
    except ModelUnavailableError as error:
        raise HTTPException(503, "Detection model is unavailable; manual labels still work") from error
    labels = []
    for item in detection.detections:
        x, y = max(0, item.bbox.x), max(0, item.bbox.y)
        width, height = min(item.bbox.width, 1 - x), min(item.bbox.height, 1 - y)
        if width > 0 and height > 0:
            labels.append(MotorcycleLabel(id=uuid.uuid4().hex, bbox=LabelBox(x=x, y=y, width=width, height=height),
                                          ground_point=None, occluded=False))
    return labels  # Suggestions only: no saved/reviewed ground truth is changed.


@router.post("/{dataset}/export")
def export_dataset(dataset: str = Dataset):
    folder = workspace(dataset)
    with database(folder) as db:
        samples = [decode_sample(row["payload"]) for row in db.execute("SELECT payload FROM samples ORDER BY id")]
    if not samples or any(not s.reviewed or s.split == "unassigned" for s in samples):
        raise HTTPException(422, "Review every image and choose its split before exporting")
    assigned = {}
    for sample in samples:
        if sample.session in assigned and assigned[sample.session] != sample.split:
            raise HTTPException(422, "Images from the same filename date cross splits; correct the assignments before exporting")
        assigned[sample.session] = sample.split
    staging = folder / "exports" / (".pending-" + uuid.uuid4().hex)
    counts = {split: 0 for split in ("train", "val", "test")}
    # Readable names numbered by original filename; the JSON keeps the hash ID and filename for traceability.
    samples.sort(key=lambda s: (s.filename.lower(), s.id))
    width = max(4, len(str(len(samples))))
    try:
        for split in counts:
            (staging / split / "images").mkdir(parents=True)
            (staging / split / "labels").mkdir()
        (staging / "annotations").mkdir()
        sessions = {}
        for number, sample in enumerate(samples, start=1):
            name = f"{dataset}_{number:0{width}d}"
            counts[sample.split] += 1
            sessions[name] = sample.session
            shutil.copyfile(folder / "images" / f"{sample.id}.png", staging / sample.split / "images" / f"{name}.png")
            lines = [f"0 {a.bbox.x + a.bbox.width / 2:.8f} {a.bbox.y + a.bbox.height / 2:.8f} {a.bbox.width:.8f} {a.bbox.height:.8f}" for a in sample.annotations]
            (staging / sample.split / "labels" / f"{name}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            (staging / "annotations" / f"{name}.json").write_text(sample.model_dump_json(indent=2), encoding="utf-8")
        (staging / "sessions.json").write_text(json.dumps(sessions, indent=2), encoding="utf-8")
        (staging / "README.txt").write_text("Images are normalized PNG. JSON box/ground coordinates are normalized 0..1. Null ground points are unconfirmed. YOLO txt contains only class 0 boxes. Never merge a capture session across splits.\n", encoding="utf-8")
        export_id = publish_export(staging, datetime.now(UTC).astimezone().strftime("%Y-%m-%d_%H%M%S"))
    finally:
        if staging.exists():
            shutil.rmtree(staging)  # Server-generated UUID directory below the fixed workspace only.
    return {"export_id": export_id, "path": f"tools/yolo-training/datasets/{dataset}/exports/{export_id}",
            "counts": counts, "ready_for_training": all(counts.values())}


def publish_export(staging: Path, stamp: str) -> str:
    """Move a finished export to a timestamp name; a same-second export gets a suffix and never overwrites."""
    for attempt in range(1, 1000):
        export_id = stamp if attempt == 1 else f"{stamp}_{attempt}"
        destination = staging.parent / export_id
        if destination.exists():
            continue
        try:
            staging.rename(destination)
            return export_id
        except FileExistsError:
            continue
    raise HTTPException(409, "Too many exports this second; retry")
