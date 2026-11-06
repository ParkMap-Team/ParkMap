"""Lightweight snapshot validation, aspect-preserving preprocessing and reports."""

import csv
import hashlib
import html
import json
import math
import os
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
# Train-only augmentation policies; val/test always use plain letterboxing.
AUGMENTATIONS = ("none", "mild", "strong")


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_run(root, allow_provisional=False, classes=None):
    """Verify the whole snapshot; `classes` optionally limits the returned samples to a declared subset."""
    root = Path(root).resolve()
    if not (root / "COMPLETE").is_file():
        raise ValueError("Use the prepared run directory containing COMPLETE, not its classification subfolder")
    leakage = verify_output(root)
    audit = json.loads((root / "audit_after.json").read_text(encoding="utf-8"))
    if audit["status"] != "reviewed" and not allow_provisional:
        raise ValueError("Dataset is provisional; set allow_provisional=true for an explicitly exploratory baseline")
    rows = [r for r in read_jsonl(root / "manifest.jsonl") if r["disposition"] == "included"]
    observed = sorted(audit["classes"])
    if classes is not None and (len(set(classes)) != len(classes) or not set(classes) <= set(observed)):
        raise ValueError(f"classes must be unique names observed in the snapshot: {sorted(set(classes) - set(observed))}")
    kept = observed if classes is None else sorted(classes)
    if len(kept) < 2:
        raise ValueError("Classification requires at least two observed classes")
    samples = {split: [] for split in SPLITS}
    expected = set()
    for row in rows:
        relative = PurePosixPath(row["classification_path"])
        if len(relative.parts) != 4 or relative.parts[:3] != ("classification", row["split"], row["canonical_class"]) or row["canonical_class"] not in observed or row["split"] not in SPLITS:
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
        if row["canonical_class"] in kept:
            samples[row["split"]].append(row)
    actual = {p.relative_to(root).as_posix() for p in (root / "classification").rglob("*") if p.is_file()}
    if actual != expected:
        raise ValueError("Classification folder does not match included manifest crops")
    if not all(samples.values()):
        raise ValueError("Train, val and test must each have at least one crop")
    absent = set(kept) - {r["canonical_class"] for r in samples["train"]}
    if absent:
        raise ValueError(f"Classes without training examples: {sorted(absent)}; review grouping/data first")
    metadata = json.loads((root / "reproducibility.json").read_text(encoding="utf-8"))
    return {"snapshot": str(root), "fingerprint": metadata["fingerprint"], "manifest_sha256": sha256(root / "manifest.jsonl"),
            "classes": kept, "excluded_classes": sorted(set(observed) - set(kept)),
            "split_crops": {s: len(v) for s, v in samples.items()}, "status": audit["status"],
            "similar_pairs_pending": audit["similar_pairs_pending"],
            "similar_pairs_cross_split_proposed": audit.get("similar_pairs_cross_split_proposed", 0),
            "unconfirmed_included_annotations": audit["unconfirmed_included_annotations"], "leakage": leakage,
            "class_coverage": {name: audit["classes"][name] for name in kept},
            "train_only_splits": {s["id"]: sorted(s.get("train_only_splits", [])) for s in metadata["config"]["sources"]}}, samples


def sampling_weights(rows, train_only_splits, copies):
    """Count each pre-augmented source photo once: its `copies` exported versions share one photo's sampling weight."""
    return [1 / copies if row["original_split"] in train_only_splits[row["source_dataset"]] else 1.0 for row in rows]


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
    # A multi-source snapshot also reports each source, so a pinned source stays comparable with earlier runs.
    sources = sorted({row.get("source_dataset") for row in samples} - {None})
    if len(sources) > 1:
        metrics["by_source"] = {}
        for source in sources:
            pairs = [(t, p) for row, t, p in zip(samples, targets, predictions, strict=True) if row.get("source_dataset") == source]
            metrics["by_source"][source] = classification_metrics([t for t, _ in pairs], [p for _, p in pairs], classes)
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
    page = f'<!doctype html><meta charset="utf-8"><title>{title}</title><style>body{{font:16px system-ui;padding:20px;background:#eef2f7}}main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}}article{{background:white;padding:12px;overflow-wrap:anywhere}}img{{width:100%;height:200px;object-fit:contain}}</style><h1>{title}</h1><p>Dataset status: {html.escape(str(metadata["status"]))}. Exploratory results; score is not calibrated certainty or a parking-availability claim.</p><p>Top-1: {metrics["top1"]:.3f} · Macro F1: {metrics["macro_f1"]:.3f}</p>{"".join(f"<p>{html.escape(name)}: top-1 {value['top1']:.3f} · macro F1 {value['macro_f1']:.3f} ({value['samples']} crops)</p>" for name, value in metrics.get("by_source", {}).items())}<main>{"".join(cards) or "No misclassified crops in this split."}</main>'
    (output / "mistakes.html").write_text(page, encoding="utf-8")
    return metrics
