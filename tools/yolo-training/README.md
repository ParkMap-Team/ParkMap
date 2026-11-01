# YOLO training experiments

## Local Label and VS Code Terminal

Run `start-dev.bat`, open Calibration UI and choose **Label** (or `/label`).
Open a dataset name, add images, draw/edit boxes or request YOLO proposals. Select
**จุดสัมผัสพื้น** and click the wheel-ground contact nearest the camera; leave null
if it is not visible. Mark occluded motorcycles and review the whole image before
checking its review box. Capture groups come from the original filename date;
there is no manual session field. Formats include `20261028_1103`,
`2026-10-28_1103`, and `28-10-2026_1103`. All images from the same day must stay in
one split, even when their times differ. Unreadable/invalid dates share one
`undated` group. Choose train/val/test manually, then save. Export requires all
workspace images reviewed and assigned. A session spanning midnight still needs
the same split on both days; filename dates alone do not prove independence.

Exports go to `datasets/<dataset>/exports/<export-id>/` with `train/val/test` image
and label directories, `sessions.json`, and JSON annotations with normalized 0..1
box/ground coordinates and occlusion. Filenames use canonical image IDs; original
names remain in JSON. Uploaded images are converted to metadata-free PNG with
normalized EXIF orientation; label coordinates refer to these saved PNGs.
Each export is new. A partial export is not ready to train until every split has
data. All workspace images, SQLite databases, labels and exports are ignored by Git.

From the repository root in VS Code Terminal, using the existing API environment:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/train.py --dataset "tools/yolo-training/datasets/<dataset>/exports/<export-id>" --validate-only
uv run --project apps/vision-api --no-sync python tools/yolo-training/train.py --dataset "tools/yolo-training/datasets/<dataset>/exports/<export-id>" --epochs 150 --device cpu
```

Epoch progress is printed in Terminal. Training writes to ignored `runs/`, and
downloaded base weights go to ignored `weights/`. API weights are never replaced.
The project's locked environment uses CPU PyTorch; CUDA training needs a compatible
GPU environment configured separately. Select a checkpoint using val. Only then
evaluate the locked test split explicitly:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/train.py --dataset "<export-directory>" --checkpoint "<chosen-best.pt>" --evaluate-test
```

This command reports test mAP, not occlusion/ROI-miss breakdown. Extra JSON flags
are retained for a dedicated evaluator; no occlusion performance is claimed here.
There is no Training web page and the website cannot start a training run.

## Optional Colab notebook

Open `notebooks/ParkMap_YOLO_Training_Evaluation.ipynb` in a private Google Colab
session. It experiments with YOLO11s at 960 px and does not replace API weights.
Ultralytics is pinned to the version in the API manifest; actual Python/Torch/CUDA
versions are recorded with each experiment.

1. Prepare independent `train`, `val`, and `test` directories on the team's private
   Drive, each containing `images/` and `labels/`. Each image needs a same-stem YOLO
   label file. An explicitly reviewed background image gets an empty label file.
   Never substitute test for val. Keep every capture session in one split and lock
   test before training/model selection, per the
   [evaluation protocol](../../docs/detector-evaluation-protocol.md).
2. Add `sessions.json` at the dataset root, mapping every image stem to its real
   capture session. Example format: `{"frame_001": "2026-10-28-morning"}`. Use actual
   sessions, not one invented identity per image. Session IDs cannot cross splits.
   SHA-256 also detects identical image files across splits; visually similar frames
   still require human review and correct session grouping.
3. Edit the Configuration cell. Run validation and optionally enable private GT
   previews. Existing two-split datasets must be reorganized first; the notebook
   does not move files or split the dataset itself.
4. Set `RUN_TRAINING=True` when ready. CUDA is selected if available, otherwise CPU.
   Each Configuration run creates a unique experiment name. Checkpoints come from
   that trainer, never a guessed `b1`/`b4` path. Generated YAML and reports go under
   `PROJECT/runs/parkmap`, not into the dataset or repository.
5. Select a model using val, then set `RUN_TEST_EVALUATION=True` in section 6 for
   held-out test and run from that section downward. Do not rerun Configuration or
   training just to enable evaluation.
   `EVAL_CHECKPOINT=None` selects the model trained in this session. Set an explicit
   path to evaluate an existing model. Repeatedly selecting models or thresholds
   using test invalidates the held-out-test interpretation.
6. Reports include checkpoint SHA-256, split fingerprints, environment, inference
   settings, mAP and separate confidence-ordered greedy TP/FP/FN metrics. Undefined
   denominators are null. This measures bounding boxes only, not Parking ROI misses
   or occlusion breakdown required by the full evaluation protocol.
7. To compare with the web, set `RUN_SINGLE_IMAGE_CHECK=True` and `CHECK_IMAGE` to
   the exact upload. Match checkpoint/image hashes, settings and environment. Compare
   inference boxes before ROI filtering; no fixed prediction count is assumed.
   Replacing API weights is a separate reviewed action.

Training, test evaluation and private previews are disabled by default. Clear all
outputs and execution counts before committing. Keep datasets, labels, session
manifests, weights and run reports on the team Drive. Follow the
[footage policy](../../docs/footage-policy.md).

Run helper checks from the repository root using the existing API Python environment
with Pillow installed:

```powershell
apps\vision-api\.venv\Scripts\python.exe -m unittest discover -s tools/yolo-training/tests -v
```

Checks extract only pure notebook helper definitions and use temporary synthetic
images. They never mount Drive, install packages, train, or run inference.
