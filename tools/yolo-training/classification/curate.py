"""Audit a prepared snapshot before handoff: EDA, image quality, cross-split near
duplicates and suspected labels, plus an offline review queue. No classifier is trained;
a frozen pretrained encoder and a cross-validated linear probe only rank items for review."""

import argparse
import json
import os
import platform
from collections import Counter, defaultdict
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import uuid4

import numpy as np
from classifier_data import validate_run
from curate_page import render_review
from prepare import SPLITS

EMBEDDING_MODEL = "facebook/dinov2-small"  # Apache-2.0, safetensors weights
EMBEDDING_REVISION = "ed25f3a31f01632728cabb09d1542f84ab7b0056"
EMBEDDING_SIZE = 224
QUALITY_ISSUES = ("dark", "light", "blurry", "low_information", "grayscale", "odd_aspect_ratio")
SMALL_CROP_PIXELS = 64
NEIGHBOURS = 3
NEAR_DUPLICATE_QUANTILE = 99.9


def eda(rows, train_only_splits):
    """Counts a handoff reader needs: class x source x split, groups, crop sizes and pre-augmented share."""
    by_class = defaultdict(Counter)
    by_source = defaultdict(Counter)
    class_source = defaultdict(Counter)
    groups = defaultdict(set)
    class_groups = defaultdict(lambda: defaultdict(set))
    sizes = defaultdict(list)
    pre_augmented = Counter()
    for row in rows:
        split, name, source = row["split"], row["canonical_class"], row["source_dataset"]
        by_class[name][split] += 1
        by_source[source][split] += 1
        class_source[name][source] += 1
        groups[split].add(row["group_id"])
        class_groups[name][split].add(row["group_id"])
        sizes[source].append(min(row["crop"]["width"], row["crop"]["height"]))
        if row["original_split"] in train_only_splits[source]:
            pre_augmented[source] += 1
    totals = {split: {"crops": sum(c[split] for c in by_class.values()), "groups": len(groups[split])} for split in SPLITS}
    crop_sizes = {}
    for source, values in sorted(sizes.items()):
        p5, p50, p95 = np.percentile(values, [5, 50, 95]).tolist()
        crop_sizes[source] = {"min_side_p5": p5, "min_side_median": p50, "min_side_p95": p95,
                              f"min_side_below_{SMALL_CROP_PIXELS}": sum(v < SMALL_CROP_PIXELS for v in values)}
    classes = {name: {"crops": {s: counts[s] for s in SPLITS}, "groups": {s: len(class_groups[name][s]) for s in SPLITS},
                      "sources": dict(sorted(class_source[name].items()))} for name, counts in sorted(by_class.items())}
    return {"totals": totals, "classes": classes,
            "sources": {s: {"crops": {k: c[k] for k in SPLITS}, "pre_augmented_crops": pre_augmented[s]} for s, c in sorted(by_source.items())},
            "crop_sizes": crop_sizes}


def cross_split_pairs(embeddings, splits, threshold, block=1024):
    """Pairs (i, j, cosine) with i < j in different splits and cosine >= threshold, most similar first.
    Rows must be L2-normalized. Blocked so memory stays O(block * n)."""
    splits = np.asarray(splits)
    found = []
    for start in range(0, len(embeddings), block):
        sims = embeddings[start:start + block] @ embeddings.T
        rows, cols = np.nonzero(sims >= threshold)
        rows = rows + start
        keep = (rows < cols) & (splits[rows] != splits[cols])
        found += [(int(i), int(j), float(sims[i - start, j])) for i, j in zip(rows[keep], cols[keep])]
    return sorted(found, key=lambda item: -item[2])


def photo_groups(rows, policies):
    """Probe folds keep each source photo together. Roboflow augmented copies share a photo key; other crops
    keep their split group. Conservative split groups (e.g. every video frame of a source) are not reused,
    because holding out a whole source would make the probe flag source style instead of labels."""
    keys = []
    for row in rows:
        name = PurePosixPath(row["source_image"]).name
        if policies.get(row["source_dataset"], {}).get("roboflow_stem") and ".rf." in name:
            keys.append(f"{row['source_dataset']}|{name.split('.rf.')[0]}")
        else:
            keys.append(row["group_id"])
    return keys


def similarity_reference(embeddings, photos, labels, quantile=NEAR_DUPLICATE_QUANTILE, block=1024):
    """Calibrates the near-duplicate threshold. Known copies (augmented versions of one photo) show how similar
    duplicates can be; each crop's most similar crop of another class shows how similar different vehicles get.
    The threshold is that different-class similarity at `quantile`, so few different vehicles pass it."""
    by_photo = defaultdict(list)
    for index, photo in enumerate(photos):
        by_photo[photo].append(index)
    copies = []
    for members in by_photo.values():
        if len(members) > 1:
            sims = embeddings[members] @ embeddings[members].T
            copies += sims[np.triu_indices(len(members), 1)].tolist()
    labels = np.asarray(labels)
    different = []
    for start in range(0, len(embeddings), block):
        sims = embeddings[start:start + block] @ embeddings.T
        sims[labels[start:start + block, None] == labels[None, :]] = -1
        different += sims.max(axis=1).tolist()
    quantiles = [1, 5, 25, 50, 75, 95, 99, 99.9]
    summary = lambda values: {f"p{q:g}": float(v) for q, v in zip(quantiles, np.percentile(values, quantiles))} if values else {}
    return {"copy_pairs": len(copies), "copies": summary(copies), "nearest_different_class": summary(different),
            "calibrated_threshold": float(np.ceil(np.percentile(different, quantile) * 1000) / 1000)}


def out_of_fold_probabilities(features, labels, groups, n_classes, folds, seed):
    """Group-aware cross-validated linear probe: every row is scored by a model that never saw its group."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedGroupKFold
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    labels = np.asarray(labels)
    probabilities = np.zeros((len(labels), n_classes))
    for train, held_out in StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed).split(features, labels, groups):
        probe = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
        probe.fit(features[train], labels[train])
        # A class absent from this fold's training rows keeps probability 0 for its held-out rows.
        probabilities[np.ix_(held_out, probe.classes_)] = probe.predict_proba(features[held_out])
    return probabilities


def suspected_labels(labels, probabilities):
    """cleanlab confident-learning label issues, most severe first, with the probe's suggestion."""
    from cleanlab.filter import find_label_issues

    ranked = find_label_issues(np.asarray(labels), probabilities, return_indices_ranked_by="self_confidence")
    return [{"index": int(i), "given_probability": float(probabilities[i, labels[i]]),
             "suggested": int(probabilities[i].argmax()), "suggested_probability": float(probabilities[i].max())} for i in ranked]


def nearest_examples(embeddings, index, labels, photos, label, count=NEIGHBOURS):
    """Most similar crops of `label` from other photos, to show the reviewer what that class looks like."""
    sims = embeddings @ embeddings[index]
    candidates = np.flatnonzero((np.asarray(labels) == label) & (np.asarray(photos) != photos[index]))
    return candidates[np.argsort(-sims[candidates])[:count]].tolist()


def quality_flags(paths):
    """CleanVision image-property issues per path; duplicates are handled by hashes and embeddings instead."""
    from cleanvision import Imagelab

    lab = Imagelab(filepaths=[str(p) for p in paths], verbose=False)
    lab.find_issues({name: {} for name in QUALITY_ISSUES}, verbose=False)
    issues = lab.issues
    flags = {}
    for path in paths:
        row = issues.loc[str(path)]
        found = {name: float(row[f"{name}_score"]) for name in QUALITY_ISSUES if row[f"is_{name}_issue"]}
        if found:
            flags[str(path)] = found
    return flags


def embed(paths, device, batch_size):
    """L2-normalized DINOv2 CLS embeddings of letterboxed crops (no stretching or center crop)."""
    import torch
    from PIL import Image, ImageOps
    from transformers import AutoImageProcessor, AutoModel

    processor = AutoImageProcessor.from_pretrained(EMBEDDING_MODEL, revision=EMBEDDING_REVISION)
    model = AutoModel.from_pretrained(EMBEDDING_MODEL, revision=EMBEDDING_REVISION, use_safetensors=True).to(device).eval()
    fill = tuple(round(255 * m) for m in processor.image_mean)
    chunks = []
    with torch.inference_mode():
        for start in range(0, len(paths), batch_size):
            images = []
            for path in paths[start:start + batch_size]:
                with Image.open(path) as image:
                    images.append(ImageOps.pad(image.convert("RGB"), (EMBEDDING_SIZE, EMBEDDING_SIZE), method=Image.Resampling.BILINEAR, color=fill))
            inputs = processor(images=images, do_resize=False, do_center_crop=False, return_tensors="pt").to(device)
            output = model(**inputs).pooler_output
            chunks.append(torch.nn.functional.normalize(output, dim=1).cpu().numpy())
            print(f"Embedded {min(start + batch_size, len(paths))}/{len(paths)}", end="\r", flush=True)
    print(flush=True)
    return np.concatenate(chunks).astype(np.float32)


def pending_dhash_pairs(root, rows):
    """Unreviewed, non-auto-linked dHash pairs whose images' included crops sit in different splits."""
    split_by_image = defaultdict(set)
    for row in rows:
        split_by_image[row["image_id"]].add(row["split"])
    pairs = []
    for pair in json.loads((root / "similar_pairs.json").read_text(encoding="utf-8")):
        a, b = pair["images"]
        if pair.get("auto_linked") or pair["review"] or not split_by_image[a] or not split_by_image[b]:
            continue
        if split_by_image[a] != split_by_image[b]:
            pairs.append((a, b, pair["dhash_distance"]))
    return pairs


def queue_items(root, run, rows, classes, embeddings, photos, near, dhash, issues, flags, pinned):
    """Review queue payload. Every item names annotation/image IDs that the pipeline review schema accepts."""
    by_image = defaultdict(list)
    for index, row in enumerate(rows):
        by_image[row["image_id"]].append(index)
    labels = [classes.index(r["canonical_class"]) for r in rows]

    def crop(index):
        row = rows[index]
        source_image = root / row["source_preview"] if row.get("source_preview") else None
        return {"annotation_id": row["annotation_id"], "image_id": row["image_id"], "label": row["canonical_class"],
                "split": row["split"], "source": row["source_dataset"], "pinned": row["source_dataset"] in pinned,
                "original_split": row["original_split"], "file": row["source_image"],
                "size": [row["crop"]["width"], row["crop"]["height"]],
                "src": quote(os.path.relpath(root / row["classification_path"], run).replace(os.sep, "/")),
                "source_src": quote(os.path.relpath(source_image, run).replace(os.sep, "/")) if source_image else None}

    items, seen_pairs = [], set()
    for i, j, cosine in near:
        key = tuple(sorted((rows[i]["image_id"], rows[j]["image_id"])))
        seen_pairs.add(key)
        items.append({"id": f"pair:{rows[i]['annotation_id']}|{rows[j]['annotation_id']}", "kind": "pair", "method": "embedding",
                      "score": round(cosine, 4), "crops": [crop(i), crop(j)]})
    for a, b, distance in dhash:
        if tuple(sorted((a, b))) in seen_pairs:
            continue
        # Images can hold several crops; show them all and only allow grouping when each image has one.
        left, right = by_image[a], by_image[b]
        items.append({"id": f"dhash:{a}|{b}", "kind": "pair", "method": "dhash", "score": distance,
                      "crops": [crop(left[0]), crop(right[0])], "multi_crop": len(left) > 1 or len(right) > 1,
                      "extra": [crop(k) for k in left[1:] + right[1:]]})
    for issue in issues:
        i = issue["index"]
        items.append({"id": f"label:{rows[i]['annotation_id']}", "kind": "label", "crops": [crop(i)],
                      "suggested": classes[issue["suggested"]], "score": round(issue["given_probability"], 4),
                      "suggested_probability": round(issue["suggested_probability"], 4),
                      "suggested_examples": [crop(k) for k in nearest_examples(embeddings, i, labels, photos, issue["suggested"])],
                      "given_examples": [crop(k) for k in nearest_examples(embeddings, i, labels, photos, labels[i])]})
    index_by_path = {str(root / r["classification_path"]): k for k, r in enumerate(rows)}
    for path, found in sorted(flags.items(), key=lambda item: min(item[1].values())):
        i = index_by_path[path]
        items.append({"id": f"quality:{rows[i]['annotation_id']}", "kind": "quality", "crops": [crop(i)],
                      "issues": sorted(found), "score": round(min(found.values()), 4)})
    return items


def eda_markdown(title, e):
    """Split, source and class tables for one EDA block."""
    lines = [f"## {title}", "", "| split | crops | known groups |", "|---|---:|---:|"]
    lines += [f"| {s} | {v['crops']} | {v['groups']} |" for s, v in e["totals"].items()]
    lines += ["", "| source | train | val | test | pre-augmented crops | min side p5 / median | crops < 64 px |", "|---|---:|---:|---:|---:|---|---:|"]
    for source, v in e["sources"].items():
        size = e["crop_sizes"][source]
        lines.append(f"| {source} | {v['crops']['train']} | {v['crops']['val']} | {v['crops']['test']} | {v['pre_augmented_crops']} | "
                     f"{size['min_side_p5']:.0f} / {size['min_side_median']:.0f} | {size[f'min_side_below_{SMALL_CROP_PIXELS}']} |")
    lines += ["", "| class | train | val | test | train groups | val groups | test groups | crops by source |", "|---|---:|---:|---:|---:|---:|---:|---|"]
    for name, v in sorted(e["classes"].items(), key=lambda item: -sum(item[1]["crops"].values())):
        c, g = v["crops"], v["groups"]
        lines.append(f"| {name} | {c['train']} | {c['val']} | {c['test']} | {g['train']} | {g['val']} | {g['test']} | "
                     + ", ".join(f"{s} {n}" for s, n in v["sources"].items()) + " |")
    return lines + [""]


def audit_limitations(pinned):
    limitations = [
        "Every finding is a ranked candidate for human review; nothing is removed, relabelled or regrouped automatically.",
        "Embedding similarity and dHash do not prove the same physical vehicle; a high score can be a different bike of the same model in a similar pose.",
        "The linear probe sees DINOv2 features, so it also flags crops whose source style differs; a flag is not proof of a wrong label.",
        "Probe top-1 is a data-audit signal over all splits, not an estimate of classifier accuracy.",
        "Probe folds group crops by source photo (Roboflow copies together), not by the conservative split groups; near-identical video frames can still fall in different folds, which hides some label errors.",
        "DINOv2 cosine does not separate augmented copies of one photo from different bikes of another class; the near-duplicate threshold keeps different-class matches rare, so the pair queue is a lower bound on duplicates.",
    ]
    if pinned:
        limitations.append("Decisions about pinned sources (" + ", ".join(sorted(pinned))
                           + ") cannot be applied while their splits are pinned; applying them needs an unpinned re-split.")
    return limitations


def write_markdown(path, report):
    """Human-readable EDA/audit summary for the handoff and presentation."""
    d, a = report["dataset"], report["audit"]
    ref = a["similarity_reference"]
    copies, different = ref["copies"], ref["nearest_different_class"]
    lines = ["# Classifier dataset audit", "", f"Snapshot `{d['fingerprint']}` | status **{d['status']}** | {report['created_at']}", "",
             f"Handoff classes ({len(d['classes'])}): {', '.join(d['classes'])}.",
             "Counts are crops (annotation boxes), not distinct motorcycles. No classifier was trained.", ""]
    lines += eda_markdown("Handoff classes", report["eda"]["handoff_classes"])
    lines += ["## Audit findings (review queue)", "",
              f"- Cross-split near duplicates (DINOv2 cosine >= {a['near_duplicate_threshold']}): **{a['near_duplicate_pairs']}** pairs.",
              (f"  Calibration: most similar other-class crop median {different['p50']:.3f} / p99.9 {different['p99.9']:.3f}; "
               f"{ref['copy_pairs']} known augmented-copy pairs median {copies.get('p50', float('nan')):.3f} / p25 {copies.get('p25', float('nan')):.3f}. "
               "Copies often score below different-class crops, so this queue misses many duplicates; it is a lower bound."),
              f"  {a['near_duplicate_pairs_same_class']} of the pairs share a class. By source:split: "
              + "; ".join(f"{k} {v}" for k, v in a["near_duplicate_pairs_by_source_split"].items()) + ".",
              f"- Pending cross-split dHash pairs from preparation: **{a['dhash_pairs_pending_cross_split']}**.",
              f"- Suspected label issues (cleanlab on a {a['probe_folds']}-fold group-aware linear probe): **{a['label_issues']}**.",
              f"  Probe out-of-fold top-1 (an audit signal, not model accuracy): {a['probe_out_of_fold_top1']:.3f}. By source: "
              + "; ".join(f"{k} {v}" for k, v in a["label_issues_by_source"].items()) + ".",
              f"- Image-quality flags (CleanVision): **{a['quality_flagged_crops']}** crops"
              + ("; " + ", ".join(f"{k} {v}" for k, v in a["quality_counts"].items()) if a["quality_counts"] else "") + ".",
              "", "## Limitations", ""] + [f"- {text}" for text in report["limitations"]] + [""]
    lines += eda_markdown("Appendix: every snapshot class", report["eda"]["all_classes"])
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path(__file__).with_name("prepared") / "run-c2809f621c207077a0a7",
                        help="Prepared run directory containing COMPLETE")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("training.top10-external.json"),
                        help="Training config whose `classes` (null = all) defines the handoff subset audited")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("runs"))
    parser.add_argument("--near-duplicate-threshold", type=float, default=None,
                        help=f"Cosine for cross-split pairs; default: p{NEAR_DUPLICATE_QUANTILE:g} of each crop's most similar other-class crop")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20261105)
    parser.add_argument("--device", default="auto", help="auto, cpu, mps or cuda")
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args(argv)
    if args.near_duplicate_threshold is not None and not 0 < args.near_duplicate_threshold <= 1 or args.folds < 2 or args.batch_size < 1:
        parser.error("threshold must be in (0, 1], folds >= 2, batch size >= 1")
    import torch

    device = args.device if args.device != "auto" else "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    subset = json.loads(args.config.read_text(encoding="utf-8")).get("classes")
    summary, samples = validate_run(args.dataset, allow_provisional=True, classes=subset)
    root = Path(summary["snapshot"])
    rows = [row for split in SPLITS for row in samples[split]]
    all_summary, all_samples = validate_run(root, allow_provisional=True) if subset else (summary, samples)
    all_rows = [row for split in SPLITS for row in all_samples[split]]
    metadata = json.loads((root / "reproducibility.json").read_text(encoding="utf-8"))
    pinned = {s["id"] for s in metadata["config"]["sources"] if s.get("pinned_splits")}
    previews = {i["image_id"]: i.get("preview") for i in json.loads((root / "images.json").read_text(encoding="utf-8"))}
    for row in rows:
        row["source_preview"] = previews.get(row["image_id"])
    run = args.output.resolve() / f"curation-{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
    run.mkdir(parents=True)
    paths = [root / r["classification_path"] for r in rows]
    classes = summary["classes"]
    labels = [classes.index(r["canonical_class"]) for r in rows]
    photos = photo_groups(rows, {s["id"]: s.get("grouping", {}) for s in metadata["config"]["sources"]})
    splits = [r["split"] for r in rows]

    print(f"Snapshot {summary['fingerprint']}: {len(rows)} crops, {len(classes)} classes | device {device}", flush=True)
    report_eda = {"handoff_classes": eda(rows, summary["train_only_splits"]), "all_classes": eda(all_rows, summary["train_only_splits"])}
    print("Checking image quality (CleanVision)...", flush=True)
    flags = quality_flags(paths)
    print(f"Embedding with {EMBEDDING_MODEL}@{EMBEDDING_REVISION[:7]}...", flush=True)
    embeddings = embed(paths, device, args.batch_size)
    np.save(run / "embeddings.npy", embeddings)
    (run / "embedding_rows.json").write_text(json.dumps([r["annotation_id"] for r in rows]), encoding="utf-8")
    reference = similarity_reference(embeddings, photos, labels)
    threshold = args.near_duplicate_threshold or reference["calibrated_threshold"]
    near = cross_split_pairs(embeddings, splits, threshold)
    dhash = pending_dhash_pairs(root, rows)
    print(f"Label audit: {args.folds}-fold group-aware probe + cleanlab...", flush=True)
    probabilities = out_of_fold_probabilities(embeddings, labels, photos, len(classes), args.folds, args.seed)
    issues = suspected_labels(labels, probabilities)
    items = queue_items(root, run, rows, classes, embeddings, photos, near, dhash, issues, flags, pinned)
    pair_sources = Counter(" / ".join(sorted(f"{rows[k]['source_dataset']}:{rows[k]['split']}" for k in (i, j))) for i, j, _ in near)
    quality_counts = Counter(name for found in flags.values() for name in found)
    report = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "dataset": {key: summary[key] for key in ("snapshot", "fingerprint", "manifest_sha256", "status", "split_crops", "leakage", "classes", "excluded_classes")},
        "options": {"config": str(args.config), "near_duplicate_threshold": args.near_duplicate_threshold, "near_duplicate_quantile": NEAR_DUPLICATE_QUANTILE, "folds": args.folds, "seed": args.seed, "device": device,
                    "embedding_model": EMBEDDING_MODEL, "embedding_revision": EMBEDDING_REVISION, "embedding_input": f"letterbox {EMBEDDING_SIZE}",
                    "quality_issue_types": list(QUALITY_ISSUES)},
        "versions": {"python": platform.python_version(), **{p: version(p) for p in ("torch", "transformers", "cleanlab", "cleanvision", "scikit-learn", "numpy")}},
        "eda": report_eda,
        "audit": {"near_duplicate_threshold": threshold, "near_duplicate_pairs": len(near), "similarity_reference": reference,
                  "near_duplicate_pairs_by_source_split": dict(pair_sources.most_common()),
                  "near_duplicate_pairs_same_class": sum(labels[i] == labels[j] for i, j, _ in near),
                  "label_issues_by_source": dict(Counter(rows[x["index"]]["source_dataset"] for x in issues).most_common()),
                  "label_issues_by_split": dict(Counter(rows[x["index"]]["split"] for x in issues).most_common()),
                  "dhash_pairs_pending_cross_split": len(dhash), "label_issues": len(issues), "probe_folds": args.folds,
                  "probe_out_of_fold_top1": float((probabilities.argmax(axis=1) == np.asarray(labels)).mean()),
                  "quality_flagged_crops": len(flags), "quality_counts": dict(sorted(quality_counts.items())),
                  "queue_items": dict(Counter(item["kind"] for item in items))},
        "pinned_sources": sorted(pinned),
        "limitations": audit_limitations(pinned),
    }
    (run / "audit.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(run / "AUDIT.md", report)
    (run / "queue.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    render_review(run / "review.html", items, all_summary["classes"], report)
    print(json.dumps(report["audit"], indent=2), flush=True)
    print(f"Report: {run / 'AUDIT.md'}\nReview queue: {run / 'review.html'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
