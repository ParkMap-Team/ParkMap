# Train the motorcycle model-family classifier

## Quick start (Windows, GPU or CPU)

From the repository root:

```powershell
.\train-classifier setup          # once, needs internet: CUDA PyTorch environment for the GPU
.\train-classifier check          # GPU or CPU, every model's settings, dataset summary; trains nothing
.\train-classifier run            # menu: pick one model, several ("1 3 4") or a = all, trained one after another
.\train-classifier run yolo26n    # skip the menu: train one model by its name in experiments.json
.\train-classifier run all        # every model in turn, then print them ranked by val macro-F1
.\train-classifier test yolo26n   # held-out test of that model's newest run; do it once, after choosing by val
```

**All settings are in [experiments.json](experiments.json)**, the only file to edit. `dataset` and `output` are shared;
`defaults` holds `epochs`, `patience` (0 turns early stopping off), `batch_size`, `learning_rate`, `seed`, `device`,
`fine_tune` and the rest; each entry under `models` names a model and sets its `architecture` plus anything that should
differ from `defaults`. The order of the entries is the order of the `run` menu, and an optional `note` is the hint shown
there. Names use letters, digits, `-` or `_`. Options typed after the name win over the file for that run, e.g.
`.\train-classifier run resnet18 --epochs 10 --device cpu`. The older single-experiment `training*.json` files still work
with `train.py --config`.

Three optional keys fight overfitting (they go in `defaults` or in one model's block; leaving them out gives the earlier behaviour):
`"augmentation": "strong"` adds random shift, scale (0.85-1.1), tilt (up to 10 degrees) and stronger colour jitter to **train** images only
(`"basic"`, the default, is flip plus mild jitter); `"weight_decay"` (default 0.01, AdamW's own) and `"label_smoothing"` (default 0,
applied to the training loss only, so val loss stays comparable). `convnext_aug`, `convnext_reg` and `convnext_aug_reg` test each change on
ConvNeXt-Tiny, alone and together, against the plain `convnext_tiny` run; `summary.csv` records the three settings per run.

Models available out of the box (all except YOLO12 start from ImageNet-pretrained weights and train the last layer only):

| Name in the file | `architecture` | Notes |
| --- | --- | --- |
| `yolo26n`, `yolo11n` | `yolo26n_cls`, `yolo11n_cls` | Ultralytics nano classifiers, ~2.8M parameters |
| `yolo12n` | `yolo12n_cls` | **Ultralytics publishes no pretrained YOLO12 classification weights**, so it trains the whole network from scratch (`"fine_tune": true` is required and checked); expect weak results on ~1k crops |
| `convnext_tiny` | `convnext_tiny` | 28M parameters; recommended to try first for accuracy on fine-grained classes |
| `mobilenet_v3` | `mobilenet_v3_large` | 5.5M parameters; recommended for fast CPU inference in the API |
| `efficientnet`, `resnet18` | `efficientnet_b0`, `resnet18` | Earlier baselines |

Other YOLO sizes need only a new line: `"yolo26s": { "architecture": "yolo26s_cls" }` (`n`, `s`, `m`, `l`, `x` for YOLO11,
YOLO12 and YOLO26; larger ones train slower). The Parking page lists any completed run of these architectures. Which model is
best on this data is for the comparison to show: pretrained transfer usually matters more than the newest architecture.

**Outputs are kept** under `classification/runs/`: one folder per run named `train-<date>-<time>-<model name>-<id>`
(checkpoints, `history.csv`, `val/` reports, and `run.json` with the exact settings used), and **`runs/summary.csv`** with
one row per finished run (model, best epoch, patience, val top-1, val macro-F1, val loss) for comparing models in one place.

`setup` builds `tools/yolo-training/.venv-gpu` (ignored by Git) with the same package versions as the API lock but a
CUDA PyTorch build. The API's own locked environment stays CPU-only and is used when that folder is absent.
The commands call Python directly, so `uv` need not be on PATH except for `setup`. The first `run` downloads
the pretrained weights; the script uses certifi's CA bundle for that because the Windows store on some machines lacks
github.com's root. Details and the long forms follow.

## Long form

From the **ParkMap repository root** in VS Code Terminal, run:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py
```

This is the command that actually starts training. The default configuration is
already pinned to the reviewed dataset: **46 classes, 1,019 train / 222 val / 220
test crops**, `prepared/run-4cb0b6637def7634bde2`. It deliberately does not follow
the moving `prepared/latest.json` pointer. A later review/preparation run therefore
cannot silently change the data for this experiment.

Training uses the project's locked Python 3.12 environment, which already has
Torch, Torchvision and Pillow. If that environment is missing, first install it
with `uv sync --project apps/vision-api --locked --all-groups`. The project lock
uses CPU PyTorch on Windows; `auto` will select CPU there. The `setup` environment
from the quick start runs the same script on CUDA (`auto` picks it); it was verified for
all three architectures and `--fine-tune` on an RTX 4070 SUPER. Colab has not been
tested. No new web page or training service is used.

## Before training

To verify the real snapshot without loading Torch, downloading weights, creating
a run or training, use:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --validate-only
```

The script verifies all prepared file hashes, crop/manifest alignment, class order,
decoding, required splits and known exact-image/group leakage. It refuses changed
snapshots and classes with no train samples. Empty val/test class coverage is
retained in the dataset metadata and metrics, never silently relabelled/dropped.

This dataset remains **provisional**: all included labels have confirmation flags
from the supplied review, but 298 similar-image pairs remain unchecked, including
150 crossing the current splits. `training.json` explicitly sets
`allow_provisional: true` for exploratory baseline training. Validation metrics
may be optimistic until those relationships are reviewed. They do not establish
accuracy for the ParkMap camera or safe parking availability. Model-family
classification does not measure vehicle dimensions.

## Baseline and settings

The baseline is [Torchvision ResNet18](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.resnet18.html)
with `IMAGENET1K_V1` pretrained weights and a new head for the dataset classes,
following the [PyTorch transfer-learning approach](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html).
By default only the classifier head is trained; backbone parameters **and BatchNorm
running statistics** are frozen. This establishes a simple baseline before full
fine-tuning or architectural comparisons.

The **first actual training command** downloads the original pretrained weights
to ignored `classification/weights/`. It does not happen for `--validate-only`.
For offline training, provide the original Torchvision ImageNet ResNet18
`state_dict` with `--initial-weights <local-file.pth>`; this is different from a
ParkMap trained classifier checkpoint or YOLO detector weights. The initial
weights' full SHA-256 is saved in run metadata.

Defaults in `training.json`:

- 10 epochs, batch size 16, 224×224 model input, AdamW learning rate 0.001.
- Two CPU threads and zero data-loader workers for a modest Windows default.
- Seed 20261102; deterministic Torch algorithms requested. Results are not
  guaranteed bit-for-bit identical across devices or dependency versions.
- Each full crop is scaled proportionally and padded to a square; there is no
  center crop or stretching. Padding is RGB 124/116/104 and normalization is the
  ImageNet mean/std, recorded as `letterbox_rgb_v1` in checkpoints.
- Mild horizontal flips/color jitter apply **only to train**. Val/test use
  deterministic letterboxing and normalization. No val/test augmentation,
  oversampling, synthetic examples, or split reassignment is performed.
- The source export was already stretched before preparation; this preprocessing
  cannot recover its original aspect ratio.

Optional overrides:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --epochs 20 --batch-size 8 --device cpu
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --fine-tune --learning-rate 0.0001
```

To use another prepared snapshot, pass `--dataset "<prepared-run-directory>"` or
edit the config. Pass the parent run directory containing COMPLETE and the
manifest, **not** its classification subfolder. Training output must stay outside
that immutable snapshot.

## Progress and outputs

The Terminal reports the epoch number, batches, train loss/top-1, and val
loss/top-1/macro F1. Each invocation creates a fresh ignored directory:

```text
classification/runs/train-<YYYYMMDD-HHMMSS local>-<architecture>-<6-hex id>/
  # e.g. train-20261102-230415-yolo11n-cls-a1b2c3; held-out evaluation uses test-...
  run.json                  # exact dataset fingerprint, options, versions, status
  classes.json              # class-index mapping
  history.csv               # flushed after each completed epoch
  best.pt                   # selected only using val
  last.pt                   # latest completed epoch
  val/
    metrics.json            # per-class precision/recall/F1 and support
    confusion_matrix.csv    # rows=true, columns=predicted
    predictions.jsonl
    mistakes.html           # offline gallery of misclassified validation crops
```

`best.pt` maximizes **val macro F1**, breaking ties with lower val loss. F1 includes
zero-score classes with ground-truth support; classes absent from an evaluation
split have undefined recall/F1 (`null`) and are excluded from the supported-class
macro average, with their count reported. Overall top-1 is also reported so class
imbalance is visible alongside per-class results.

At the end the script reloads best.pt and writes its validation report. Open
`val/mistakes.html` in your browser to inspect errors in bulk; retain its relative
links to the prepared dataset when moving artifacts. Reports contain private
crops/labels and remain outside Git. They are standalone files, not a training
website. API model weights and the deployed detector are never replaced.

Ctrl+C leaves checkpoints from completed epochs and marks the run interrupted.
No test predictions or test metrics are produced by the training command.

## Held-out test, later

After reviewing identity leakage and selecting a checkpoint using val, evaluate
test explicitly:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --evaluate-test --checkpoint "<training-run>/best.pt"
```

It writes a new `runs/test-.../` report using that checkpoint's exact class order
and preprocessing. A different dataset fingerprint/class mapping is rejected.
Loading uses `torch.load(weights_only=True)` with a state_dict checkpoint, not a
pickled custom model. The classifier is closed-set: it chooses among its learned
classes; its softmax score is not calibrated certainty and there is no trained
unknown class. Do not use test to choose hyperparameters/checkpoints or infer
real-camera performance from this public-image experiment.

## Verification

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/classification/tests -v
uv run --project apps/vision-api --no-sync ruff check tools/yolo-training/classification
```

Training tests perform one tiny synthetic ResNet18 epoch on CPU without pretrained
weights/downloads, check frozen BatchNorm, checkpoint compatibility and the explicit
test-evaluation route. A deliberately invalid test-image path proves the training
path does not load held-out test rows. Real data is checked with `--validate-only`;
no real training, pretrained weight download, CUDA run or Colab run is performed
as part of implementation verification.
