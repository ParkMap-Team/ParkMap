"""Browse a curate.py audit in the FiftyOne App: every audited crop with its split, source and
audit flags, plus a 2D UMAP map of the saved DINOv2 embeddings. Read-only for the snapshot;
review decisions are still made in review.html or the preparation gallery."""

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

import numpy as np

FLAG_TAGS = {"pair": "cross_split_pair", "label": "label_suspect", "quality": "quality_issue"}


def audit_tags(items):
    """annotation_id -> sorted tags and the probe's suggested class, from queue.json."""
    tags, suggested = defaultdict(set), {}
    for item in items:
        for crop in item["crops"]:
            tags[crop["annotation_id"]].add(FLAG_TAGS[item["kind"]])
        if item["kind"] == "quality":
            tags[item["crops"][0]["annotation_id"]].update(f"quality:{name}" for name in item["issues"])
        if item["kind"] == "label":
            suggested[item["crops"][0]["annotation_id"]] = item["suggested"]
    return {key: sorted(value) for key, value in tags.items()}, suggested


def build_dataset(audit_run, name=None):
    os.environ.setdefault("FIFTYONE_DO_NOT_TRACK", "true")  # read when fiftyone is first imported
    import fiftyone as fo
    import fiftyone.brain as fob

    audit_run = Path(audit_run).resolve()
    report = json.loads((audit_run / "audit.json").read_text(encoding="utf-8"))
    root = Path(report["dataset"]["snapshot"])
    order = json.loads((audit_run / "embedding_rows.json").read_text(encoding="utf-8"))
    embeddings = np.load(audit_run / "embeddings.npy")
    if len(order) != len(embeddings):
        raise ValueError("embeddings.npy and embedding_rows.json disagree; rerun curate.py")
    tags, suggested = audit_tags(json.loads((audit_run / "queue.json").read_text(encoding="utf-8")))
    manifest = {}
    with (root / "manifest.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            manifest[row["annotation_id"]] = row
    dataset = fo.Dataset(name or f"parkmap-{audit_run.name}", overwrite=True)
    samples = []
    for annotation in order:
        row = manifest[annotation]
        sample = fo.Sample(filepath=str(root / row["classification_path"]), tags=[row["split"], *tags.get(annotation, [])])
        sample["ground_truth"] = fo.Classification(label=row["canonical_class"])
        if annotation in suggested:
            sample["probe_suggestion"] = fo.Classification(label=suggested[annotation])
        sample["annotation_id"], sample["image_id"], sample["group_id"] = annotation, row["image_id"], row["group_id"]
        sample["split"], sample["source_dataset"], sample["original_split"] = row["split"], row["source_dataset"], row["original_split"]
        samples.append(sample)
    dataset.add_samples(samples)
    # Samples were added in embedding order; FiftyOne keeps insertion order. UMAP is slow (minutes to tens of
    # minutes), so the 2D points are cached next to the embeddings; an audit run directory is never rewritten.
    points_path = audit_run / "umap_points.npy"
    if points_path.exists():
        points = np.load(points_path)
        if points.shape != (len(embeddings), 2):
            raise ValueError(f"{points_path.name} does not match embeddings.npy; delete it to recompute")
        fob.compute_visualization(dataset, points=points, brain_key="dinov2_umap")
    else:
        results = fob.compute_visualization(dataset, embeddings=embeddings, method="umap", brain_key="dinov2_umap")
        np.save(points_path, results.points)
    return dataset


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audit", type=Path, help="runs/curation-... directory written by curate.py")
    parser.add_argument("--port", type=int, default=5151)
    args = parser.parse_args(argv)
    dataset = build_dataset(args.audit)
    import fiftyone as fo

    print(f"Loaded {len(dataset)} crops. In the App: open the Embeddings panel (brain key dinov2_umap), color by "
          "ground_truth, and filter tags such as label_suspect or cross_split_pair. Ctrl+C to stop.", flush=True)
    fo.launch_app(dataset, port=args.port).wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
