"""Create transfer/replay data without moving the parent's held-out groups."""

import argparse
import copy
import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from classifier_data import sha256
from prepare import (
    Groups,
    digest,
    duplicate_groups,
    find_similar,
    json_bytes,
    leakage_report,
    read_jsonl,
    verify_output,
    write_json,
)


def select_rows(parent_rows, incoming_rows, source, replay=False):
    selected = [copy.deepcopy(r) for r in parent_rows if r["disposition"] == "included" and (replay or r["split"] in {"val", "test"})]
    selected.extend(copy.deepcopy(r) for r in incoming_rows if r["disposition"] == "included" and r["source_dataset"] == source)
    if not any(r["disposition"] == "included" and r["source_dataset"] == source and r["split"] == "train" for r in incoming_rows):
        raise ValueError("Incoming source has no training crops")
    return selected


def build_transfer(parent, incoming, checkpoint, source, output, replay=False):
    parent, incoming, checkpoint, output = (Path(p).resolve() for p in (parent, incoming, checkpoint, output))
    if output.is_relative_to(parent) or output.is_relative_to(incoming):
        raise ValueError("Output must be separate from input snapshots")
    for root in (parent, incoming):
        verify_output(root)
    meta = json.loads((checkpoint.parent / "run.json").read_text(encoding="utf-8"))
    reproduction = json.loads((parent / "reproducibility.json").read_text(encoding="utf-8"))
    if reproduction.get("warm_start_parent"):
        raise ValueError("Chained transfer requires accumulated exposure history; use the original parent snapshot")
    parent_audit = json.loads((parent / "audit_after.json").read_text(encoding="utf-8"))
    classes = sorted(parent_audit["classes"])
    parent_info = {"classes": classes, "fingerprint": reproduction["fingerprint"], "manifest_sha256": sha256(parent / "manifest.jsonl"),
                   "checkpoint_sha256": sha256(checkpoint)}
    if meta.get("run_state") != "complete" or any(meta["dataset"][key] != parent_info[key] for key in ("classes", "fingerprint", "manifest_sha256")) or meta["best_checkpoint_sha256"] != parent_info["checkpoint_sha256"]:
        raise ValueError("Parent checkpoint does not match the original training snapshot")
    all_rows = [read_jsonl(root / "manifest.jsonl") for root in (parent, incoming)]
    selected = select_rows(*all_rows, source, replay=replay)
    if any(not r["label_confirmed"] for r in selected):
        raise ValueError("Transfer data must be human-confirmed")
    lookup = {}
    groups_by_input = defaultdict(list)
    crop_groups = defaultdict(list)
    for number, root in enumerate((parent, incoming)):
        for image in json.loads((root / "images.json").read_text(encoding="utf-8")):
            old = lookup.get(image["image_id"])
            if old and old["pixel_sha256"] != image["pixel_sha256"]:
                raise ValueError("Source image ID changed pixels")
            lookup[image["image_id"]] = image
            groups_by_input[(number, image["group_id"])].append(image["image_id"])
        for row in all_rows[number]:
            if row.get("crop"):
                crop_groups[row["crop"]["pixel_sha256"]].append(row["image_id"])
    grouping = Groups(lookup)
    for ids in [*groups_by_input.values(), *crop_groups.values()]:
        grouping.union(ids)
    for field in ("pixel_sha256", "byte_sha256"):
        for ids in duplicate_groups(list(lookup.values()), field):
            grouping.union(ids)
    exposure = defaultdict(set)
    history = [r for r in all_rows[0] if r["disposition"] == "included"]
    for row in history + selected:
        exposure[grouping.find(row["image_id"])].add(row["split"])
    bad = {key: sorted(value) for key, value in exposure.items() if len(value) > 1}
    if bad:
        raise ValueError(f"Transfer split conflicts with parent exposure history: {bad}")
    code_hash = digest(Path(__file__).read_bytes() + Path(__file__).with_name("prepare.py").read_bytes())
    fingerprint = digest(json_bytes([parent_info, source, replay, [sha256(r / "integrity.json") for r in (parent, incoming)], code_hash]))
    run = output / ("run-" + fingerprint[:20])
    if run.exists():
        if not (run / "COMPLETE").exists():
            raise ValueError("Incomplete transfer snapshot; use a new output directory")
        verify_output(run)
        write_json(output / "latest.json", {"run": run.name, "source": source, "status": "provisional"})
        return run
    run.mkdir(parents=True)
    parent_ids = {r["annotation_id"] for r in all_rows[0]}
    for row in selected:
        root = parent if row["annotation_id"] in parent_ids else incoming
        original = row["classification_path"]
        row["input_snapshot"] = str(root)
        row["group_id"] = "group-" + grouping.find(row["image_id"])
        relative = f"classification/{row['split']}/{row['canonical_class']}/{row['annotation_id'].replace(':', '-')}.png"
        destination = run / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / original, destination)
        row["classification_path"] = relative
        row["crop"]["path"] = relative
    used_ids = {r["image_id"] for r in selected}
    images = [copy.deepcopy(lookup[key]) for key in sorted(used_ids)]
    for image in images:
        image["group_id"] = "group-" + grouping.find(image["image_id"])
        image["assigned_split"] = next(r["split"] for r in selected if r["image_id"] == image["image_id"])
        image.pop("preview", None)
    coverage = {}
    for name in classes:
        rows = [r for r in selected if r["canonical_class"] == name]
        counts = {s: {"crops": sum(r["split"] == s for r in rows), "groups": len({r["group_id"] for r in rows if r["split"] == s})} for s in ("train", "val", "test")}
        coverage[name] = {"splits": counts, "limitation": "no_new_training_examples_requires_parent_weights" if not counts["train"]["crops"] else None}
        for split in counts:
            (run / "classification" / split / name).mkdir(parents=True, exist_ok=True)
    leakage = leakage_report(selected, images)
    if any(leakage.values()):
        raise ValueError(f"Transfer leakage: {leakage}")
    similar = [p for p in find_similar(list(lookup.values()), 6)
               if all(exposure[grouping.find(key)] for key in p["images"])]
    near_cross = sum(len(set().union(*(exposure[grouping.find(key)] for key in p["images"]))) > 1 for p in similar)
    audit = {"status": "provisional", "ready_for_production": False, "classes": coverage, "classification_crops": len(selected),
             "split_counts": dict(Counter(r["split"] for r in selected)), "train_source": source, "replay": replay,
             "training_crops_by_source": dict(Counter(r["source_dataset"] for r in selected if r["split"] == "train")),
             "unconfirmed_included_annotations": 0, "leakage": leakage, "parent_history_group_overlap": 0,
             "similar_pairs_pending": len(similar), "similar_pairs_cross_split_proposed": near_cross,
             "limitations": ["Known hash/group checks do not identify every different-angle or recompressed vehicle image.",
                             "Validation selects checkpoints; neither source test set is evaluated.",
                             "Parent training crops are replayed without oversampling." if replay else "Only the incoming source trains; absent training classes retain parent output units and may be forgotten.",
                             "Near-duplicate checks include the parent's historical training images; proposed pairs are unverified."]}
    write_json(run / "images.json", images)
    write_json(run / "audit_after.json", audit)
    write_json(run / "similar_pairs.json", similar)
    write_json(run / "reproducibility.json", {"fingerprint": fingerprint, "pipeline_sha256": code_hash,
                                             "warm_start_parent": parent_info, "inputs": [str(parent), str(incoming)]})
    write_json(run / "parent_exposure.json", [{"annotation_id": r["annotation_id"], "image_id": r["image_id"], "split": r["split"],
                                              "group_id": "group-" + grouping.find(r["image_id"])} for r in history])
    (run / "manifest.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in selected), encoding="utf-8")
    write_json(run / "integrity.json", {p.relative_to(run).as_posix(): sha256(p) for p in run.rglob("*") if p.is_file()})
    (run / "COMPLETE").write_text(fingerprint + "\n", encoding="utf-8")
    verify_output(run)
    write_json(output / "latest.json", {"run": run.name, "source": source, "status": "provisional"})
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("parent", "incoming", "checkpoint", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--replay", action="store_true", help="Include the parent's training crops; keep all holdout roles unchanged")
    args = parser.parse_args()
    print(build_transfer(args.parent, args.incoming, args.checkpoint, args.source, args.output, replay=args.replay))


if __name__ == "__main__":
    main()
