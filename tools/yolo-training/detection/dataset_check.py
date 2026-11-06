"""Validate an exported private dataset before a terminal training run."""

import hashlib
import json
import math
from pathlib import Path

from PIL import Image


def validate_dataset(root: Path, class_ids=("0",)) -> dict:
    """Check splits, sessions, hashes and YOLO box labels; class_ids come from config."""
    class_ids = {str(c) for c in class_ids}
    root = root.resolve()
    manifest = root / "sessions.json"
    if not manifest.is_file():
        raise ValueError("Missing sessions.json; label/export capture sessions first")
    sessions = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(sessions, dict):
        raise TypeError("sessions.json must map image stems to capture sessions")
    used_sessions, used_hashes, used_names = {}, {}, set()
    report = {}
    for split in ("train", "val", "test"):
        images = sorted(p for p in (root / split / "images").glob("*") if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
        labels = root / split / "labels"
        stems = [p.stem for p in images]
        if not images or len(stems) != len(set(stems)) or set(stems) != {p.stem for p in labels.glob("*.txt")}:
            raise ValueError(f"{split}: requires images with unique names and complete matching labels")
        digest = hashlib.sha256()
        box_count = 0
        for image in images:
            if image.stem in used_names:
                raise ValueError("Image names cross splits")
            used_names.add(image.stem)
            session = sessions.get(image.stem)
            if not isinstance(session, str) or not session.strip():
                raise ValueError(f"Missing capture session: {image.name}")
            if session in used_sessions and used_sessions[session] != split:
                raise ValueError("One capture session crosses splits")
            used_sessions[session] = split
            with image.open("rb") as stream:
                file_hash = hashlib.file_digest(stream, "sha256").hexdigest()
            if file_hash in used_hashes and used_hashes[file_hash] != split:
                raise ValueError("Identical image content crosses splits")
            used_hashes[file_hash] = split
            with Image.open(image) as decoded:
                if decoded.getexif().get(274, 1) != 1:
                    raise ValueError("Normalize image orientation and review labels before training")
                decoded.load()
            label = labels / f"{image.stem}.txt"
            text = label.read_text(encoding="utf-8-sig")
            for line in text.splitlines():
                if not line.strip():
                    continue
                parts = line.split()
                if len(parts) != 5 or parts[0] not in class_ids:
                    raise ValueError(f"{label.name}: expected a configured class id and four box coordinates")
                x, y, w, h = map(float, parts[1:])
                if not all(math.isfinite(v) for v in (x, y, w, h)) or w <= 0 or h <= 0 or not all(-1e-6 <= v <= 1 + 1e-6 for v in (x - w / 2, y - h / 2, x + w / 2, y + h / 2)):
                    raise ValueError(f"{label.name}: invalid or out-of-image box")
                box_count += 1
            digest.update(json.dumps([image.name, file_hash, text, session]).encode())
        report[split] = {"images": len(images), "boxes": box_count, "sha256": digest.hexdigest()}
    if report["train"]["boxes"] == 0:
        raise ValueError("Training split needs labelled motorcycles")
    return report
