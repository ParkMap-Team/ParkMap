"""Evaluate a trained classifier on human-labelled crops from a real parking lot.

No training or checkpoint selection happens here. The lot dataset supplies crops.jsonl
(crop_id, file_name, split, sha256) and labels/<labeler>.jsonl, where the latest row
per crop_id wins. Special labels and labels outside the checkpoint's classes are
counted and reported, never scored.
"""

import argparse
import json
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from classifier_data import sha256, write_evaluation

SPECIAL_LABELS = ("unknown", "ambiguous", "not_motorcycle")
SPLITS = ("train", "val", "test")
LABELER_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def lot_samples(lot, labeler, splits, classes):
    lot = Path(lot).resolve()
    labels = {}
    for line in (lot / "labels" / f"{labeler}.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        labels[row["crop_id"]] = row["label"]
    samples = {split: [] for split in splits}
    excluded = {split: Counter() for split in splits}
    for line in (lot / "crops.jsonl").read_text(encoding="utf-8").splitlines():
        crop = json.loads(line)
        if crop["split"] not in splits:
            continue
        label = labels.get(crop["crop_id"])
        if label is None or label in SPECIAL_LABELS or label not in classes:
            excluded[crop["split"]]["unlabelled" if label is None else label if label in SPECIAL_LABELS else f"not_in_model_classes:{label}"] += 1
            continue
        path = lot / crop["file_name"]
        if path.is_symlink() or not path.resolve().is_relative_to(lot) or sha256(path) != crop["sha256"]:
            raise ValueError(f"Crop differs from crops.jsonl: {crop['file_name']}")
        samples[crop["split"]].append({"annotation_id": crop["crop_id"], "classification_path": crop["file_name"], "canonical_class": label})
    return samples, excluded


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True, help="best.pt of a completed training run")
    parser.add_argument("--lot", type=Path, required=True, help="Lot dataset directory containing crops.jsonl and labels/")
    parser.add_argument("--labeler", required=True, help="Use only labels/<labeler>.jsonl")
    parser.add_argument("--splits", default="val,test", help="Comma-separated lot splits, each reported separately")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("runs"))
    parser.add_argument("--device", default="auto", help="auto, cpu, cuda[:N] or mps")
    args = parser.parse_args(argv)
    splits = tuple(args.splits.split(","))
    if not set(splits) <= set(SPLITS) or len(set(splits)) != len(splits):
        parser.error("--splits takes a comma-separated subset of train,val,test")
    if not LABELER_RE.fullmatch(args.labeler):
        parser.error("--labeler must be 1-32 letters, digits, _ or -")
    try:
        checkpoint_path = args.checkpoint.resolve()
        meta = json.loads((checkpoint_path.parent / "run.json").read_text(encoding="utf-8"))
        if meta.get("run_state") != "complete" or sha256(checkpoint_path) != meta["best_checkpoint_sha256"]:
            raise ValueError("Checkpoint is not the best.pt of a completed training run")
        summary = meta["dataset"]
        samples, excluded = lot_samples(args.lot, args.labeler, splits, summary["classes"])
        if not all(samples.values()):
            raise ValueError(f"Every split needs at least one scorable crop: {({s: len(v) for s, v in samples.items()})}")
        # Heavy imports only after the lightweight checks pass.
        from classifier_engine import (
            build_model,
            evaluate,
            load_checkpoint,
            loader,
            seed_everything,
            select_device,
        )

        checkpoint = load_checkpoint(checkpoint_path, summary)
        seed_everything(meta["options"]["seed"], meta["options"]["threads"])
        device = select_device(args.device)
        model = build_model(summary["classes"], weights_dir=None, pretrained=False).to(device)
        model.load_state_dict(checkpoint["state_dict"])
        options = {**meta["options"], "image_size": checkpoint["image_size"], "workers": 0}
        lot = args.lot.resolve()
        output = args.output.resolve() / f"lot-{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
        report = {}
        for split in splits:
            metrics, predictions, scores = evaluate(model, loader(lot, samples[split], summary["classes"], options), device, summary["classes"])
            write_evaluation(output / split, lot, split, samples[split], predictions, scores, summary["classes"],
                             {"status": f"real-lot labels by {args.labeler}", "checkpoint_sha256": meta["best_checkpoint_sha256"],
                              "dataset_fingerprint": summary["fingerprint"], "loss": metrics["loss"], "lot": str(lot),
                              "labeler": args.labeler, "excluded": dict(excluded[split])})
            report[split] = {"top1": metrics["top1"], "macro_f1": metrics["macro_f1"], "scored": metrics["samples"],
                             "excluded": dict(excluded[split])}
        print(json.dumps({"checkpoint": str(checkpoint_path), "report": str(output), "splits": report}, indent=2), flush=True)
        return 0
    except (OSError, KeyError, TypeError, ValueError, RuntimeError) as error:
        parser.exit(2, f"Lot evaluation failed: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
