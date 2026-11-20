"""Lightweight snapshot validation, aspect-preserving preprocessing and reports."""

import csv
import hashlib
import html
import json
import math
import os
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from PIL import Image, ImageOps
from prepare import SPLITS, read_jsonl, verify_output

PREPROCESSING = {
    "protocol": "letterbox_rgb_v1",
    "padding_rgb": [124, 116, 104],
    "mean": [0.485, 0.456, 0.406],
    "std": [0.229, 0.224, 0.225],
    "resize": "contain_bilinear_then_center_pad_no_crop_no_stretch",
}


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def balanced_weights(rows):
    """Per-crop draw weights: every class equally likely, and within a class every known group equally likely.

    A class with thousands of crops, or one group of thousands of video frames, then weighs the same as a rare class or a
    single photograph. Keyed by (class, group) because one source image may hold several classes.
    """
    groups = Counter((row["canonical_class"], row["group_id"]) for row in rows)
    groups_per_class = Counter(name for name, _ in groups)
    return [1.0 / (groups_per_class[row["canonical_class"]] * groups[(row["canonical_class"], row["group_id"])]) for row in rows]


def validate_imagefolder(root, allow_provisional=False, *, evaluation_only=False, classes=None):
    """A plain ImageFolder (train/ val/ test/ <class>/ files) listed by manifest.csv (path, split, class, source, ..., id).

    Not a prepare.py snapshot: there are no group or leakage records, so every file is its own group and only exact
    byte duplicates across splits are detected (they are refused). Splits are used exactly as given.
    """
    if not allow_provisional:
        raise ValueError("An ImageFolder dataset is not a reviewed snapshot; set allow_provisional=true to train on it")
    with (root / "manifest.csv").open(encoding="utf-8", newline="") as stream:
        listed = list(csv.DictReader(stream))
    required = {"path", "split", "class", "id"}
    if not listed or not required <= set(listed[0]):
        raise ValueError(f"manifest.csv needs columns {sorted(required)}")
    rows, paths, ids, split_of_bytes, fingerprint = [], set(), set(), {}, hashlib.sha256()
    for item in sorted(listed, key=lambda r: r["path"]):
        relative = PurePosixPath(item["path"])
        if (len(relative.parts) != 3 or relative.parts[0] != item["split"] or relative.parts[1] != item["class"]
                or item["split"] not in SPLITS or not item["class"] or not item["id"]):
            raise ValueError(f"manifest.csv row does not match <split>/<class>/<file>: {item['path']}")
        path = root / relative
        if not path.resolve().is_relative_to(root) or path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing or unsafe image: {item['path']}")
        if str(relative) in paths or item["id"] in ids:
            raise ValueError(f"manifest.csv repeats a path or id: {item['path']}")
        paths.add(str(relative)); ids.add(item["id"])
        digest = sha256(path)
        if split_of_bytes.setdefault(digest, item["split"]) != item["split"]:
            raise ValueError(f"The same image bytes are in two splits: {item['path']}")
        with Image.open(path) as decoded:
            decoded.load()
            if decoded.getexif().get(274, 1) != 1:
                raise ValueError(f"Unexpected image orientation: {item['path']}")
        fingerprint.update(f"{relative}\t{digest}\n".encode())
        rows.append({"classification_path": str(relative), "split": item["split"], "canonical_class": item["class"],
                     "annotation_id": item["id"], "group_id": item["id"], "source_dataset": item.get("source", "")})
    actual = {p.relative_to(root).as_posix() for split in SPLITS if (root / split).is_dir() for p in (root / split).rglob("*") if p.is_file()}
    if actual != paths:
        raise ValueError(f"Image folders and manifest.csv differ by {len(actual ^ paths)} files")
    all_classes = sorted({r["canonical_class"] for r in rows})
    selected = sorted(set(classes)) if classes is not None else all_classes
    unknown = sorted(set(selected) - set(all_classes))
    if unknown:
        raise ValueError(f"classes not in this dataset: {unknown}")
    if len(selected) < 2:
        raise ValueError("classes must name at least two model families")
    samples = {split: [r for r in rows if r["split"] == split and r["canonical_class"] in selected] for split in SPLITS}
    if not all(samples.values()):
        raise ValueError("Train, val and test must each have at least one image")
    absent = set(selected) - {r["canonical_class"] for r in samples["train"]}
    if absent and not evaluation_only:
        raise ValueError(f"Classes without training examples: {sorted(absent)}")
    coverage = {c: {s: sum(1 for r in samples[s] if r["canonical_class"] == c) for s in SPLITS} for c in selected}
    return {"snapshot": str(root), "fingerprint": fingerprint.hexdigest(), "manifest_sha256": sha256(root / "manifest.csv"),
            "classes": selected, "split_crops": {s: len(v) for s, v in samples.items()}, "status": "imagefolder (unreviewed)",
            "similar_pairs_pending": None, "similar_pairs_cross_split_proposed": 0, "unconfirmed_included_annotations": None,
            "leakage": {"exact_bytes_cross_split": 0}, "class_coverage": coverage, "snapshot_class_count": len(all_classes),
            "missing_training_classes": sorted(absent)}, samples


def validate_run(root, allow_provisional=False, *, evaluation_only=False, classes=None):
    root = Path(root).resolve()
    if not (root / "COMPLETE").is_file() and (root / "manifest.csv").is_file() and (root / "train").is_dir():
        return validate_imagefolder(root, allow_provisional, evaluation_only=evaluation_only, classes=classes)
    if not (root / "COMPLETE").is_file():
        raise ValueError("Use the prepared run directory containing COMPLETE, not its classification subfolder")
    leakage = verify_output(root)
    audit = json.loads((root / "audit_after.json").read_text(encoding="utf-8"))
    if audit["status"] != "reviewed" and not allow_provisional:
        raise ValueError("Dataset is provisional; set allow_provisional=true for an explicitly exploratory baseline")
    rows = [r for r in read_jsonl(root / "manifest.jsonl") if r["disposition"] == "included"]
    selected, classes = classes, sorted(audit["classes"])
    if len(classes) < 2:
        raise ValueError("Classification requires at least two observed classes")
    samples = {split: [] for split in SPLITS}
    expected = set()
    for row in rows:
        relative = PurePosixPath(row["classification_path"])
        if len(relative.parts) != 4 or relative.parts[:3] != ("classification", row["split"], row["canonical_class"]) or row["canonical_class"] not in classes or row["split"] not in SPLITS:
            raise ValueError("Manifest has an invalid classification path or class")
        path = root / relative
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise ValueError("Classification images must stay within the immutable snapshot")
        if str(relative) in expected:
            raise ValueError("Manifest repeats a classification crop path")
        expected.add(str(relative))
        if sha256(path) != row["crop"]["byte_sha256"]:
            raise ValueError("Crop content differs from annotation manifest")
        with Image.open(path) as decoded:
            decoded.load()
            if decoded.getexif().get(274, 1) != 1:
                raise ValueError("Unexpected image orientation")
        samples[row["split"]].append(row)
    actual = {p.relative_to(root).as_posix() for p in (root / "classification").rglob("*") if p.is_file()}
    if actual != expected:
        raise ValueError("Classification folder does not match included manifest crops")
    snapshot_class_count = len(classes)
    if selected is not None:
        # Train on a subset of the snapshot's families. Every crop above was still verified; the split of each crop is unchanged.
        unknown = sorted(set(selected) - set(classes))
        if unknown:
            raise ValueError(f"classes not in this dataset: {unknown}")
        classes = sorted(set(selected))
        if len(classes) < 2:
            raise ValueError("classes must name at least two model families")
        samples = {split: [r for r in split_rows if r["canonical_class"] in classes] for split, split_rows in samples.items()}
    if not all(samples.values()):
        raise ValueError("Train, val and test must each have at least one crop")
    absent = set(classes) - {r["canonical_class"] for r in samples["train"]}
    if absent and not evaluation_only:
        raise ValueError(f"Classes without training examples: {sorted(absent)}; review grouping/data first")
    metadata = json.loads((root / "reproducibility.json").read_text(encoding="utf-8"))
    return {"snapshot": str(root), "fingerprint": metadata["fingerprint"], "manifest_sha256": sha256(root / "manifest.jsonl"),
            "classes": classes, "split_crops": {s: len(v) for s, v in samples.items()}, "status": audit["status"],
            "similar_pairs_pending": audit["similar_pairs_pending"],
            "similar_pairs_cross_split_proposed": audit.get("similar_pairs_cross_split_proposed", 0),
            "unconfirmed_included_annotations": audit["unconfirmed_included_annotations"], "leakage": leakage,
            "class_coverage": {c: audit["classes"][c] for c in classes}, "snapshot_class_count": snapshot_class_count,
            "missing_training_classes": sorted(absent)}, samples


class PadResize:
    """Use the whole supplied crop. No central crop or anisotropic resize."""

    def __init__(self, size):
        self.size = size

    def __call__(self, image):
        image = image.convert("RGB")
        return ImageOps.pad(image, (self.size, self.size), method=Image.Resampling.BILINEAR,
                            color=tuple(PREPROCESSING["padding_rgb"]), centering=(0.5, 0.5))


def classification_metrics(targets, predictions, classes):
    n = len(classes)
    matrix = [[0 for _ in classes] for _ in classes]
    if len(targets) != len(predictions) or not targets:
        raise ValueError("Evaluation needs paired nonempty targets/predictions")
    for truth, predicted in zip(targets, predictions, strict=True):
        if not 0 <= truth < n or not 0 <= predicted < n:
            raise ValueError("Evaluation class index out of range")
        matrix[truth][predicted] += 1
    per_class = {}
    for index, name in enumerate(classes):
        support = sum(matrix[index])
        predicted_count = sum(row[index] for row in matrix)
        tp = matrix[index][index]
        precision = tp / predicted_count if predicted_count else None
        recall = tp / support if support else None
        # With ground-truth support, no predictions means a zero F1, not omission.
        f1 = 2 * tp / (support + predicted_count) if support else None
        per_class[name] = {"support": support, "precision": precision, "recall": recall, "f1": f1}
    supported = [v for v in per_class.values() if v["support"]]
    return {"top1": sum(matrix[i][i] for i in range(n)) / len(targets),
            "macro_f1": sum(v["f1"] for v in supported) / len(supported),
            "macro_f1_supported_classes": len(supported), "samples": len(targets),
            "classes": classes, "per_class": per_class, "confusion_matrix": matrix}


def write_evaluation(output, dataset, split, samples, predictions, probabilities, classes, metadata):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    targets = [classes.index(row["canonical_class"]) for row in samples]
    metrics = classification_metrics(targets, predictions, classes)
    metrics.update(metadata)
    metrics["split"] = split
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    with (output / "confusion_matrix.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["true / predicted", *classes])
        writer.writerows([name, *row] for name, row in zip(classes, metrics["confusion_matrix"], strict=True))
    records, cards = [], []
    for row, predicted, probability in zip(samples, predictions, probabilities, strict=True):
        if not math.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError("Non-finite or invalid model score")
        record = {"annotation_id": row["annotation_id"], "image": row["classification_path"],
                  "true": row["canonical_class"], "predicted": classes[predicted], "score": probability}
        records.append(record)
        if record["true"] != record["predicted"]:
            path = Path(dataset) / row["classification_path"]
            try:
                uri = quote(Path(os.path.relpath(path, output)).as_posix(), safe="/.")
            except ValueError:
                uri = path.as_uri()
            cards.append(f'<article><img loading="lazy" src="{html.escape(uri, quote=True)}"><p>True: {html.escape(record["true"])}<br>Predicted: {html.escape(record["predicted"])}<br>Score: {probability:.3f}</p><small>{html.escape(row["annotation_id"])}</small></article>')
    (output / "predictions.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    title = f"{split}: misclassified crops ({len(cards)})"
    page = f'<!doctype html><meta charset="utf-8"><title>{title}</title><style>body{{font:16px system-ui;padding:20px;background:#eef2f7}}main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}}article{{background:white;padding:12px;overflow-wrap:anywhere}}img{{width:100%;height:200px;object-fit:contain}}</style><h1>{title}</h1><p>Dataset status: {html.escape(str(metadata["status"]))}. Exploratory results; score is not calibrated certainty or a parking-availability claim.</p><p>Top-1: {metrics["top1"]:.3f} · Macro F1: {metrics["macro_f1"]:.3f}</p><main>{"".join(cards) or "No misclassified crops in this split."}</main>'
    (output / "mistakes.html").write_text(page, encoding="utf-8")
    return metrics
