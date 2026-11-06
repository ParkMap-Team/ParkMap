# Train the motorcycle model-family classifier

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
uses CPU PyTorch on Windows; `auto` will select CPU there. A CUDA PyTorch setup
can run the same script with `--device cuda`, but CUDA/Colab execution has not
been tested in this change. No new web page or training service is used.

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
- `augment: "mild"` applies horizontal flips/color jitter **only to train**.
  `"strong"` adds square random crops (70-100% area), small rotation/shift,
  occasional downscale-then-upscale and blur (many source crops are small),
  stronger color jitter and random erasing; `"none"` disables augmentation.
  Val/test always use deterministic letterboxing and normalization. No val/test
  augmentation, oversampling, synthetic examples, or split reassignment is
  performed.
- `label_smoothing: 0.0` uses plain cross-entropy for training; a value in
  [0, 1) smooths training targets. Val loss is always unsmoothed.
- `pre_augmented_copies: 1` samples every train crop equally. A value N > 1
  gives crops from a source's `train_only_splits` (Roboflow exports with N
  augmented versions per photo) weight 1/N, so each source photo counts once.
  Epoch length is unchanged; train sampling becomes weighted with replacement
  and the run prints each source's sampling share. Val/test are unaffected.
  Roboflow file stems are not unique per photo (e.g. two `27.jpg` photos), so
  copies are down-weighted rather than deleted by name.
- The source export was already stretched before preparation; this preprocessing
  cannot recover its original aspect ratio.

Optional overrides:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --epochs 20 --batch-size 8 --device cpu
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --fine-tune --learning-rate 0.0001
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --augment strong --label-smoothing 0.1
```

To use another prepared snapshot, pass `--dataset "<prepared-run-directory>"` or
edit the config. Pass the parent run directory containing COMPLETE and the
manifest, **not** its classification subfolder. Training output must stay outside
that immutable snapshot.

## Supported model subset

`classes` in the config is `null` (every snapshot class) or a list of class names
to train on. `training.top10.json` keeps the 10 classes with at least 30 crops in
the Roboflow snapshot `prepared/run-b3119d538da84aefcf5b` (re-split after the
second 2026-11-06 review and pinned to the combined run of
`training.top10-external.json`, so both share one test split; models trained on
earlier, now deleted runs such as `run-71a1fa00b3a2357ae77d` and
`run-06a05f38ab75dc156741` used different test splits, so their results are not
directly comparable):

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.top10.json
```

The whole snapshot is still verified, and the splits are unchanged; crops of the
other classes are left out of train, val and test. `run.json` records them as
`excluded_classes` and adds a limitation. The model supports only the kept
classes and is still closed-set, so a crop of an excluded model is predicted as
one of the kept classes. Its metrics cannot be compared directly with a model
trained on every class.

## Progress and outputs

The Terminal reports the epoch number, batches, train loss/top-1, and val
loss/top-1/macro F1. Each invocation creates a fresh ignored directory:

```text
classification/runs/train-<UTC-time>-<unique-id>/
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

When a snapshot has several sources (see `config.external.json` in README),
`metrics.json` adds `by_source` with the same metrics per source, and
`mistakes.html` and the test command print them. A pinned source keeps its
earlier splits, so its `by_source` test result is the one comparable with models
trained on that source alone. `best.pt` is still chosen on the combined val.

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

## Evaluate on a real lot

To measure a trained checkpoint on human-labelled crops from a real lot (for
example the private `spu-motorcycles-20261103` dataset), run:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/evaluate_lot.py --checkpoint "<training-run>/best.pt" --lot "<lot-dataset>" --labeler <name>
```

The lot supplies `crops.jsonl` and `labels/<name>.jsonl`; only that labeler's
file is read and the latest row per crop wins. Crop hashes are verified. `unknown`,
`ambiguous`, `not_motorcycle`, unlabelled crops and labels outside the checkpoint's
classes are counted under `excluded`, never scored; report them with top-1 because
the real camera produces such crops too. Each split (`--splits`, default
`val,test`) gets its own `runs/lot-.../<split>/` report in the format above. Nothing
is trained or selected here, so a checkpoint chosen on the lot's val must be
judged on its test only.

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
