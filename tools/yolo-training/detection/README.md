# Motorcycle detector training

Everything for the detector lives in this folder; the model-family classifier is separate in
[`../classification/`](../classification/README.md). Datasets stay in the shared, Git-ignored
[`../datasets/`](../datasets) because the Label UI writes there.

## Folders

| Path | Contents |
| --- | --- |
| `config.yaml` | the only settings file |
| `train.py`, `dataset_check.py` | training/test entry point and dataset rules |
| [`notebooks/`](notebooks/README.md) | optional Colab notebook |
| [`tests/`](tests/README.md) | automated checks |
| [`runs/`](runs/README.md) | run outputs and logs (Git-ignored) |
| [`weights/`](weights/README.md) | downloaded pretrained starting weights (Git-ignored) |

## Quick start (Windows)

From the repository root:

```powershell
.\train-detector check          # validate the dataset, list every model and its settings; trains nothing
.\train-detector run            # menu: pick one model, several ("1 3") or a = all; they train one after another
.\train-detector run yolo26s    # skip the menu
.\train-detector run all        # every model in config.yaml
.\train-detector test           # menu of finished runs: evaluate one ONCE on the held-out test split
```

The GPU is used when `tools/yolo-training/.venv-gpu` exists (built once by `.\train-classifier setup`);
otherwise the API's CPU environment is used. Long form, from the repository root:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/detection/train.py [--model NAME] [--check] [--test] [--config PATH]
```

## One settings file: [`config.yaml`](config.yaml)

Nothing is hard-coded in `train.py`; change a setting only in `config.yaml`. Every value has a comment (Thai)
explaining what it does; YAML is used instead of JSON so the comments can live next to the values.

| Key | Meaning |
| --- | --- |
| `dataset` | export folder with `train/val/test` and `sessions.json` (relative to `config.yaml`) |
| `output`, `weights_dir` | where runs and downloaded base weights go (both Git-ignored) |
| `classes` | class id to name; labels with any other id are rejected |
| `train` | any Ultralytics `train()` argument (epochs, patience, imgsz, batch, device `auto`/`cpu`/`0`, seed, optimizer, lr0, augmentation ...) shared by all models; an unknown key is rejected by Ultralytics |
| `test` | arguments for the held-out evaluation (conf, iou ...); imgsz and device follow the run being tested |
| `models` | menu entries: `weights` (`.pt` = pretrained, `.yaml` = untrained architecture), `family` (`yolo` or `rtdetr`), `description`, optional `train` block overriding the shared values |

Models shipped in the menu:

| Name | Pretrained | Family | Params | When to use |
| --- | --- | --- | --- | --- |
| `yolo26s` | COCO | YOLO | 9.5M | Newest family, NMS-free, small-object tuned. Try first |
| `yolo11s` | COCO | YOLO | 9.4M | Proven baseline; earlier ParkMap default |
| `yolo26n` | COCO | YOLO | 2.4M | Fastest on CPU, for a GPU-less API |
| `yolo11n` | COCO | YOLO | 2.6M | Smallest baseline; same family as the API's current `baseline-yolo11n.pt` |
| `yolo26m` | COCO | YOLO | 20.4M | More accuracy on occluded bikes; GPU, batch 2 |
| `yolo11m` | COCO | YOLO | 20.1M | YOLO11 accuracy reference; GPU, batch 2 |
| `yolo12s` | COCO | YOLO | 9.3M | Attention-based; may help dense occlusion, slower and less stable |
| `rtdetr-l` | COCO | RT-DETR (transformer, not YOLO) | 32M | NMS-free detector for crowded scenes; GPU, batch 2 |
| `rtdetr-x` | COCO | RT-DETR (transformer, not YOLO) | 67M | Most accurate in the list, slowest; GPU, batch 1 |
| `yolo26s-scratch` | **No** | YOLO | 9.5M | Random start, only to measure how much pretraining helps; expect weak results |

COCO is a 118k-image, 80-class dataset that includes motorcycles, so pretrained models already recognise them.
The API loads models with Ultralytics `YOLO()`; an RT-DETR checkpoint needs a matching change in the API before use.

`imgsz` is 1600 because the SPU images are 3400x960: at 960 a motorcycle shrinks to roughly 28x40 px. The API must
infer at the same `imgsz` (`PARKMAP_MODEL_IMGSZ`) as the model was trained with.

## Outputs and logs

Each run gets a readable folder; the round counts every earlier run of that model:

```
runs/
  history.csv                      one row per run: status, minutes, settings, best epoch, val mAP
  yolo26s/
    round-01_2026-11-06_14-05/
      train.log                    everything printed during the run, including errors and tracebacks
      summary.json                 status (running/complete/failed/interrupted), environment, dataset hashes,
                                   settings, best epoch, val metrics, checkpoint SHA-256, later the test result
      config_used.yaml             snapshot of config.yaml at start
      data.yaml                    dataset file given to Ultralytics
      results.csv, *.png           per-epoch Ultralytics metrics and plots
      weights/best.pt, last.pt
      test/, test.log              only after `test`
```

If the process is killed from outside (out of memory, window closed) `summary.json` stays `running`, no
`history.csv` row is added and `train.log` shows where it stopped. Out of memory: lower `batch` or `imgsz` in `config.yaml`.

Choose a model by val metrics. `test` refuses a run that was already tested: the held-out split is used once.
API weights in `apps/vision-api/models/` are never changed; copying a checkpoint there is a separate reviewed step.

## Labelling in the Label UI

Run `start-dev.bat`, open Calibration UI and choose **Label** (or `/label`).
Open a dataset name, add images, draw/edit boxes or request YOLO proposals.
The current Label UI edits boxes and occlusion only; it has no ground-point tool.
Mark occluded motorcycles and review the whole image before
checking its review box. Capture groups come from the original filename date;
there is no manual session field. Formats include `20261028_1103`,
`2026-10-28_1103`, and `28-10-2026_1103`. All images from the same day must stay in
one split, even when their times differ. Unreadable/invalid dates share one
`undated` group. Choose train/val/test manually, then save. Export requires all
workspace images reviewed and assigned. A session spanning midnight still needs
the same split on both days; filename dates alone do not prove independence.

Exports go to `../datasets/<dataset>/exports/<export-id>/` with `train/val/test` image
and label directories, `sessions.json`, and JSON annotations with normalized 0..1
box coordinates and occlusion. Optional ground-point metadata from older labels
is preserved for compatibility, but is not displayed or edited by the current UI.
Filenames use canonical image IDs; original
names remain in JSON. Uploaded images are converted to metadata-free PNG with
normalized EXIF orientation; label coordinates refer to these saved PNGs.
Each export is new. A partial export is not ready to train until every split has
data. All workspace images, SQLite databases, labels and exports are ignored by Git.

The SPU photo set in `../datasets/SPU Park Label/by_date/` (polygon labels) is converted into the day-grouped
detection export `../datasets/spu-park-split/` by `../datasets/SPU Park Label/make_split.py`; edit its `DAYS` table to
move a day to another split, delete the old export and run it again. `make_split.py --roi roi.json` builds `../datasets/spu-park-split-roi/` instead: everything outside the
parking ROI is painted grey and motorcycles whose polygon centroid lies outside it are dropped. A model trained on it
must receive ROI-masked images at inference too.

`spu-park-split/train/` also holds 26 synthetic top-down images (`synthetic_*.jpg`, 3197 boxes) copied from the
`Synthentic_Data_Lebel` set. They are train-only so val and test stay real SPU photos; `sessions.json` groups
near-duplicate synthetic images into `synthetic-scene-NN`. `make_split.py` does not add them, so copy them in again after
re-exporting.

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
   [evaluation protocol](../../../docs/detector-evaluation-protocol.md).
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
[footage policy](../../../docs/footage-policy.md).

## Checks

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/detection/tests -v
```

The tests use temporary synthetic images; they never load YOLO, download weights or train.
