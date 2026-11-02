"""Merge immutable reviewed snapshots, regroup globally, and retain pending records.

No training or semantic label inference. Existing snapshots are never modified.
"""

import argparse
import copy
import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from gallery import render_gallery, write_report
from prepare import (
    SPLITS,
    assign_splits,
    audit_counts,
    digest,
    duplicate_groups,
    find_similar,
    json_bytes,
    leakage_report,
    publish_latest,
    read_jsonl,
    reconcile,
    verify_output,
    write_json,
)
from prepare_review import verify_workspace


def merge(base, workspace, output, seed=20261102):
    base, workspace, output = Path(base).resolve(), Path(workspace).resolve(), Path(output).resolve()
    if output.is_relative_to(base) or output.is_relative_to(workspace):
        raise ValueError("Output must be separate from source snapshots")
    verify_output(base)
    verify_workspace(workspace)
    code = digest(b"".join(Path(__file__).with_name(name).read_bytes() for name in
                           ("merge_reviewed.py", "prepare.py", "prepare_review.py", "gallery.py")))
    fingerprint = digest(json_bytes([digest((root / "integrity.json").read_bytes()) for root in (base, workspace)]) + code.encode() + str(seed).encode())
    run = output / ("run-" + fingerprint[:20])
    if run.exists():
        if not (run / "COMPLETE").exists():
            raise ValueError("Incomplete merge; choose a new output directory")
        verify_output(run)
        publish_latest(output, run)
        return run
    run.mkdir(parents=True)
    images, rows, sources, original_groups = [], [], [], defaultdict(list)
    review = {"version": 1, "annotations": {}, "images": {}, "same_vehicle_groups": [], "similar_pairs": []}
    for number, root in enumerate((base, workspace)):
        source_images = json.loads((root / "images.json").read_text(encoding="utf-8"))
        source_rows = read_jsonl(root / "manifest.jsonl")
        applied = json.loads((root / "review_applied.json").read_text(encoding="utf-8"))
        for key in ("annotations", "images"):
            if set(review[key]) & set(applied.get(key, {})):
                raise ValueError("Overlapping input IDs")
            review[key].update(applied.get(key, {}))
        for key in ("same_vehicle_groups", "similar_pairs"):
            review[key].extend(applied.get(key, []))
        for image in source_images:
            image["input_snapshot"] = str(root)
            image["input_group_id"] = image["group_id"]
            if image.get("preview"):
                old = image["preview"]
                image["preview"] = f"inputs/{number}/{old}"
                destination = run / image["preview"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / old, destination)
        for row in source_rows:
            row["input_snapshot"] = str(root)
            row["input_disposition"] = row["disposition"]
            row["input_split"] = row.get("split")
            original_groups[(number, row["group_id"])].append(row["annotation_id"])
            if row.get("crop"):
                old = row["crop"]["path"]
                row["crop"]["path"] = f"inputs/{number}/{old}"
                destination = run / row["crop"]["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / old, destination)
        images.extend(source_images)
        rows.extend(source_rows)
        if number == 0:
            sources.extend(json.loads((root / "audit_before.json").read_text(encoding="utf-8"))["sources"])
        else:
            metadata = json.loads((root / "workspace.json").read_text(encoding="utf-8"))
            source = metadata["config"]["source"]
            sources.append({**source, "archive_sha256": metadata["archive_sha256"],
                            "known_preprocessing": source.get("known_preprocessing", []),
                            "class_map": metadata["config"]["mapping"]})
        if (root / "credits").exists():
            shutil.copytree(root / "credits", run / "credits" / str(number))
    if len({r["annotation_id"] for r in rows}) != len(rows) or len({i["image_id"] for i in images}) != len(images):
        raise ValueError("Snapshots overlap in IDs")
    # Preserve all previously known group relationships, including augmentation families.
    review["same_vehicle_groups"].extend(ids for ids in original_groups.values() if len(ids) > 1)
    before_rows = copy.deepcopy(rows)
    conflicts, deduplications, crop_conflicts = reconcile(images, rows, review)
    for row in rows:
        if row["disposition"] == "candidate" and not row["label_confirmed"]:
            row["disposition"] = "pending_review"
        if row["disposition"] == "candidate" and (not row["crop"] or not row["canonical_class"]):
            raise ValueError("Confirmed candidate missing a crop or class")
    included = [row for row in rows if row["disposition"] == "candidate"]
    ratios = {"train": .7, "val": .15, "test": .15}
    assignments = assign_splits(included, ratios, seed)
    for image in images:
        image["assigned_split"] = assignments.get(image["group_id"])
    for row in rows:
        row.update(split=None, classification_path=None)
        if row["disposition"] == "candidate":
            row.update(split=assignments[row["group_id"]], disposition="included")
            relative = f"classification/{row['split']}/{row['canonical_class']}/{row['annotation_id'].replace(':', '-')}.png"
            destination = run / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(run / row["crop"]["path"], destination)
            row["classification_path"] = relative
    classes = {}
    for name in sorted({r["canonical_class"] for r in rows if r["canonical_class"]}):
        current = [r for r in included if r["canonical_class"] == name]
        groups = {r["group_id"] for r in current}
        counts = {s: {"crops": sum(r["split"] == s for r in current),
                      "groups": len({r["group_id"] for r in current if r["split"] == s}),
                      "source_images": len({r["image_id"] for r in current if r["split"] == s})} for s in SPLITS}
        classes[name] = {"independent_groups_known": len(groups), "splits": counts,
                         "limitation": "fewer_than_three_independent_groups" if len(groups) < 3 else
                         "missing_split_coverage" if any(not v["crops"] for v in counts.values()) else None}
        for split in SPLITS:
            (run / "classification" / split / name).mkdir(parents=True, exist_ok=True)
    lookup = {i["image_id"]: i for i in images}
    similar = find_similar(images, 6)
    decisions = {tuple(sorted(p["images"])): p for p in review["similar_pairs"]}
    for pair in similar:
        pair["review"] = decisions.get(tuple(pair["images"]), {})
    byte_groups, pixel_groups = duplicate_groups(images, "byte_sha256"), duplicate_groups(images, "pixel_sha256")
    before = {"totals": {"images": len(images), "annotation_lines": len(rows), "valid_boxes": sum(not r["issues"] for r in rows)},
              "sources": sources, "original_counts": audit_counts(images, before_rows),
              "byte_duplicate_groups": byte_groups, "pixel_duplicate_groups": pixel_groups,
              "original_byte_duplicate_groups_cross_split": sum(len({lookup[k]["original_split"] for k in g}) > 1 for g in byte_groups),
              "original_pixel_duplicate_groups_cross_split": sum(len({lookup[k]["original_split"] for k in g}) > 1 for g in pixel_groups),
              "annotation_conflicts": conflicts, "crop_label_conflicts": crop_conflicts}
    leakage = leakage_report(included, images)
    if any(leakage.values()):
        raise ValueError(f"Split leakage: {leakage}")
    after = {"status": "provisional", "ready_for_production": False, "classification_crops": len(included),
             "seed": seed, "target_ratios": ratios, "classes": classes, "known_groups_included": len(assignments),
             "unique_source_images_included": len({r["image_id"] for r in included}),
             "split_counts": {s: {"crops": sum(r["split"] == s for r in included), "groups": sum(v == s for v in assignments.values())} for s in SPLITS},
             "dispositions": dict(Counter(r["disposition"] for r in rows)), "unconfirmed_included_annotations": 0,
             "quarantined_annotations": sum(r["disposition"].startswith("quarantined") for r in rows),
             "similar_pairs_proposed": len(similar), "similar_pairs_pending": sum(not p["review"] for p in similar),
             "similar_pairs_cross_split_proposed": sum(len({lookup[k]["assigned_split"] for k in p["images"]} - {None}) > 1 for p in similar),
             "effective_duplicate_annotation_conflicts": conflicts, "effective_crop_label_conflicts": crop_conflicts,
             "deduplications": deduplications, "leakage": leakage,
             "included_by_source": dict(Counter(r["source_dataset"] for r in included)),
             "limitations": ["PROVISIONAL: only human-confirmed candidates included; other annotations retained for later review.",
                             "Resplit dataset: validation scores are not directly comparable to the first run's 67.6%.",
                             "Known group/hash leakage zero does not prove different-angle vehicle independence.",
                             "Heuristic near-duplicate pairs remain pending; source labels and real-camera accuracy are not independently verified.",
                             "Existing source stretch cannot be reversed. No new augmentation or training performed."]}
    for filename, value in (("audit_before.json", before), ("audit_after.json", after), ("images.json", images),
                            ("similar_pairs.json", similar), ("review_applied.json", review)):
        write_json(run / filename, value)
    write_json(run / "reproducibility.json", {"fingerprint": fingerprint, "pipeline_sha256": code,
                                             "inputs": [str(base), str(workspace)], "seed": seed})
    (run / "manifest.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    render_gallery(run, images, rows, before, after, similar)
    write_report(run, before, after)
    write_json(run / "integrity.json", {p.relative_to(run).as_posix(): digest(p.read_bytes()) for p in run.rglob("*") if p.is_file()})
    (run / "COMPLETE").write_text(fingerprint + "\n", encoding="utf-8")
    verify_output(run)
    publish_latest(output, run)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("prepared") / "combined-honda2")
    args = parser.parse_args()
    print(merge(args.base, args.workspace, args.output))


if __name__ == "__main__":
    main()
