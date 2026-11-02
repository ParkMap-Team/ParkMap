# Exploratory second run: reviewed HONDA 2 additions

From the ParkMap repository root in VS Code Terminal:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.honda2.json
```

This starts a new ResNet18 baseline from the original ImageNet initialization,
using the same settings as the first run. It does not resume `best.pt` or modify
the first run. No training was performed during dataset preparation.

The config pins `prepared/combined-honda2/run-a38f82ba9eebc8f5b871`: 1,651 crops
across 46 classes, split into 1,151 train / 250 validation / 250 test. It includes
1,461 original crops and 190 HONDA 2 crops. The supplied HONDA 2 review confirms
193 annotations, excludes one, and leaves 42 unconfirmed. Three confirmed
annotations are duplicate copies, so 190 enter the classification folders.
Pending and conflicting annotations remain in the manifest and review gallery;
they are not silently discarded or used for training.

The new combined grouping includes source-image identity, exact byte/pixel
duplicates, identical crop pixels, previous known groups, source-filename
augmentation groups, and explicit same-vehicle review groups. Known leakage
across the new splits is zero for all six checks in `audit_after.json`.

**PROVISIONAL:** 310 heuristic similar-image pairs are proposed, including 151
crossing assigned splits. They are candidates for human review, not automatically
deleted or treated as physical identity. One unconfirmed annotation is quarantined
because duplicate-image annotations conflict; 41 other unconfirmed annotations
remain pending. Original label/model-family accuracy and different-angle vehicle
identity are not independently verified. These are not real-camera metrics.

**Validation has changed.** The new split is group-stratified with a fixed seed,
approximately 70/15/15. Its validation score cannot be directly ranked against
the first run's 67.6% (150/222), because the validation images differ. Do not claim
that adding data improved accuracy based on that comparison alone. The test set
remains unevaluated; do not use it for tuning.

Validate without training, Torch imports, or model downloads:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.honda2.json --validate-only
```

To reproduce preparation (paths may be replaced for Colab), first stage the saved
review with `prepare_review.py --archive <original.zip> --review <review-honda2.json>`.
Then merge the resulting workspace:

```powershell
apps\vision-api\.venv\Scripts\python.exe tools/yolo-training/classification/merge_reviewed.py --base tools/yolo-training/classification/prepared/run-4cb0b6637def7634bde2 --workspace tools/yolo-training/classification/prepared/review-honda2/workspace-28303ba2526d3118ea9d
```

Both input snapshots are verified and preserved. All raw annotations, polygons,
source names, class names, license/credits and review decisions are retained in
the new manifest or input metadata. Crops are copied without resizing. Runs are
content-addressed and verified when reused. New code/reviews create a new run;
update the training pin deliberately after checking its audit.

Open `prepared/combined-honda2/index.html` for the combined review gallery and
the snapshot's `REPORT.md` / `audit_before.json` / `audit_after.json` for audit
details. The first dataset, first model, and original `training.json` stay pinned.
