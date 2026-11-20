# Train the motorcycle model-family classifier

## Quick start (Windows, GPU or CPU)

From the repository root:

```powershell
Set-Location D:\ParkMap
.\train-classifier setup          # once, needs internet: CUDA PyTorch environment for the GPU
.\train-classifier check          # GPU or CPU, every model's settings, dataset summary; trains nothing
.\train-classifier run            # menu: pick one model, several ("1 3 4") or a = all, trained one after another
.\train-classifier run yolo26n    # skip the menu: train one model by its name in experiments.yaml
.\train-classifier run all        # every model in turn, then print them ranked by val macro-F1
.\train-classifier test yolo26n   # held-out test of that model's newest run; do it once, after choosing by val
.\train-classifier evaluate yolo26n "D:\my-photos"  # folders named by class; _other for unknown families
```

### วิธีรัน Train ตาม config ปัจจุบัน

Config นี้ใช้ชุดงานวิชา **12 รุ่น** ที่ `tools/yolo-training/datasets/Classify/hf-thai-motorcycle/class-project-12`
และเก็บผลใน `tools/yolo-training/classification/runs-class-project/` โดยไม่ให้หน้า Parking โหลดโมเดลชุดนี้
ต้องเตรียม dataset ในเครื่องก่อน; repository ไม่มีภาพหรือ weights ให้ดาวน์โหลดพร้อมโค้ด

1. เปิด PowerShell ที่ root ของ repository แล้วรัน `.\train-classifier setup` ครั้งแรกเพื่อเตรียม GPU environment
   หากใช้ CPU ให้เตรียม environment ด้วย `uv sync --project apps/vision-api --locked --all-groups` และรันด้วย `--device cpu`
2. รัน `.\train-classifier check` เพื่อตรวจข้อมูลและ config ของทุกโมเดลก่อนเทรน
3. รัน `.\train-classifier run convnext_tiny` เพื่อเทรน head หรือ `.\train-classifier run convnext_ft` เพื่อ fine-tune ทั้งโมเดล
   ใช้ `.\train-classifier run all` เมื่อต้องการเทรนทุกโมเดลเรียงกัน ไม่ใช่ขนาน
4. เปรียบเทียบ `runs-class-project/summary.csv` ด้วย val macro-F1 แล้วรัน `.\train-classifier test convnext_ft`
   กับโมเดลที่เลือกเพียงครั้งเดียว ไม่ใช้ test เลือกค่าการเทรน

ค่าเริ่มต้นคือ 50 epochs, batch 8, ภาพ 224 px, balanced sampling และ learning rate คงที่ 0.001
ส่วน `convnext_ft` ใช้ 30 epochs, patience 10, learning rate 0.0001, cosine schedule และ warmup 2 epochs
ตัวอย่างปรับค่าเฉพาะรอบ: `.\train-classifier run resnet18 --epochs 10 --batch-size 4 --device cpu`
ViT ต้องมี `timm` ซึ่งคำสั่ง `setup` ติดตั้งให้; CPU environment ของ API ไม่มี dependency นี้

ชุดนี้ใช้สำหรับงานวิชาเท่านั้น ตาม README ของ dataset: ไม่เผยแพร่ภาพ/weights ไม่ใช้โมเดลใน ParkMap
และลบข้อมูลกับโมเดลหลังจบวิชา หากกลับไปใช้ dataset ของ ParkMap ให้เปลี่ยน `dataset` และ `output` เป็นคู่
โดยตรวจสิทธิ์และความเหมาะสมของข้อมูลก่อน ไม่ย้าย weights ชุดงานวิชาเข้า `runs/`

**All settings are in [experiments.yaml](experiments.yaml)**, the only file to edit. Every parameter is commented there. `dataset` and `output` are shared;
`defaults` holds `epochs`, `patience` (0 turns early stopping off), `batch_size`, `learning_rate`, `seed`, `device`,
`fine_tune` and the rest; each entry under `models` names a model and sets its `architecture` plus anything that should
differ from `defaults`. The order of the entries is the order of the `run` menu, and an optional `note` is the hint shown
there. Names use letters, digits, `-` or `_`. Options typed after the name win over the file for that run, e.g.
`.\train-classifier run resnet18 --epochs 10 --device cpu`. A flat one-experiment JSON config (no `models` section) still
works with `train.py --config`.

Three optional keys fight overfitting (they go in `defaults` or in one model's block; leaving them out gives the earlier behaviour):
`"augmentation": "strong"` adds random shift, scale (0.85-1.1), tilt (up to 10 degrees) and stronger colour jitter to **train** images only
(`"basic"`, the default, is flip plus mild jitter); `"weight_decay"` (default 0.01, AdamW's own) and `"label_smoothing"` (default 0,
applied to the training loss only, so val loss stays comparable). `convnext_aug`, `convnext_reg` and `convnext_aug_reg` test each change on
ConvNeXt-Tiny, alone and together, against the plain `convnext_tiny` run; `summary.csv` records the three settings per run.

`"sampling": "balanced"` (now in `defaults`) draws **train** crops with replacement so every class is equally likely and,
within a class, every known group (one photo, or one whole video clip) is equally likely; an epoch keeps its usual number of
draws. `"shuffle"`, the code default, is the earlier plain shuffle. Val/test are never resampled. `summary.csv` records it.

**Dataset.** The current config selects the private class-project ImageFolder with 12 families:
train 9,333 / val 240 / test 240 images, from team data and 1,013 Bing images. It requires
`allow_provisional: true`. ImageFolder validation checks its manifest, files, decoding and exact-byte leakage;
it does not verify capture groups or near-duplicate relationships. Each file is its own sampling group.
The older 46-family prepared snapshot remains an alternative, not the active default.

**Subset of families.** A top-level `classes:` list trains only the named families, e.g. `[click, aerox]`.
It is commented out in the current config, so all 12 families are used. Every crop is still
verified and keeps its split; crops of other families are simply left out, and the checkpoint has only these classes.
Remove the key to train on every family. `summary.csv` records the class count per run.

Models available out of the box (all except YOLO12 start from ImageNet-pretrained weights;
YOLO12 and `convnext_ft` train the full network, others train the last layer by default):

| Name in the file | `architecture` | Notes |
| --- | --- | --- |
| `yolo26n`, `yolo11n` | `yolo26n_cls`, `yolo11n_cls` | Ultralytics nano classifiers, ~2.8M parameters |
| `yolo12n` | `yolo12n_cls` | **Ultralytics publishes no pretrained YOLO12 classification weights**, so it trains the whole network from scratch (`"fine_tune": true` is required and checked); expect weak results on ~1k crops |
| `convnext_tiny` | `convnext_tiny` | 28M parameters; recommended to try first for accuracy on fine-grained classes |
| `mobilenet_v3` | `mobilenet_v3_large` | 5.5M parameters; recommended for fast CPU inference in the API |
| `efficientnet`, `resnet18` | `efficientnet_b0`, `resnet18` | Earlier baselines |
| `resnet50` | `resnet50` | Deeper ResNet baseline; training tool only |
| `vit_small` | `vit_small` | Requires `timm`; training tool only |
| `convnext_ft` | `convnext_tiny` | Full fine-tuning with cosine schedule and warmup |

Other YOLO sizes need only a new entry: `yolo26s: {architecture: yolo26s_cls}` (`n`, `s`, `m`, `l`, `x` for YOLO11,
YOLO12 and YOLO26; larger ones train slower). Parking only lists supported completed runs under `classification/runs/`;
the current class-project output is deliberately excluded, and its API does not support ResNet50 or ViT. Which model is
best on this data is for the comparison to show: pretrained transfer usually matters more than the newest architecture.

**Outputs are kept** under the config's `output` (`classification/runs-class-project/` currently): one folder per run named `train-<date>-<time>-<model name>-<id>`
(checkpoints, `history.csv`, `val/` reports, and `run.json` with the exact settings used), and **`<output>/summary.csv`** with
one row per finished run (model, best epoch, patience, val top-1, val macro-F1, val loss) for comparing models in one place.

`setup` builds `tools/yolo-training/.venv-gpu` (ignored by Git) with the same package versions as the API lock but a
CUDA PyTorch build. The API's own locked environment stays CPU-only and is used when that folder is absent.
The commands call Python directly, so `uv` need not be on PATH except for `setup`. The first `run` downloads
the pretrained weights; the script uses certifi's CA bundle for that because the Windows store on some machines lacks
github.com's root. Details and the long forms follow.

## Long form (without the .bat)

From the **ParkMap repository root**, the same script runs directly; `--config` defaults to `experiments.yaml` and
`--model` picks the entry (and therefore its dataset):

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --model convnext_tiny --validate-only
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --model convnext_tiny
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --model convnext_tiny --epochs 20 --batch-size 8 --device cpu
```

Training uses the project's locked Python 3.12 environment, which already has
Torch, Torchvision and Pillow. If that environment is missing, first install it
with `uv sync --project apps/vision-api --locked --all-groups`. The project lock
uses CPU PyTorch on Windows; `auto` will select CPU there. The `setup` environment
from the quick start runs the same script on CUDA (`auto` picks it); it was verified
on an RTX 4070 SUPER. Colab has not been tested. No web page or training service is used.

## Before training

`--validate-only` verifies the selected dataset without loading Torch,
downloading weights, creating a run or training. It verifies all prepared file hashes,
crop/manifest alignment, class order, decoding, required splits and known
exact-image/group leakage. It refuses changed snapshots and classes with no train
samples. Empty val/test class coverage is retained in the dataset metadata and
metrics, never silently relabelled/dropped. The `.bat check` also prints the device using Torch.
Prepared-snapshot checks include recorded group leakage; ImageFolder checks are limited as described above.
`check all` validates each distinct combination of dataset, class selection and provisional permission.

These experiments are **provisional**: labels are not all individually confirmed and
some similar-image pairs crossing the splits remain unchecked. `allow_provisional: true`
in `experiments.yaml` allows exploratory training on them. Validation metrics may be
optimistic until those relationships are reviewed. They do not establish accuracy
for the ParkMap camera or safe parking availability. Model-family classification
does not measure vehicle dimensions.

## Pretrained start and preprocessing

Every model except YOLO12 starts from ImageNet-pretrained weights with a new head for
the dataset classes, following the
[PyTorch transfer-learning approach](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html).
With `fine_tune: false` only the classifier head is trained; backbone parameters
**and BatchNorm running statistics** are frozen. See [ARCHITECTURES.md](ARCHITECTURES.md).

The **first actual training command** downloads the original pretrained weights
to ignored `classification/weights/`. It does not happen for `--validate-only`.
For offline training, provide the original ImageNet `state_dict` matching the
architecture with `--initial-weights <local-file.pth>`; this is different from a
ParkMap trained classifier checkpoint or YOLO detector weights. The initial
weights' full SHA-256 is saved in run metadata.

For every model:

- Each full crop is scaled proportionally and padded to a square; there is no
  center crop or stretching. Padding is RGB 124/116/104 and normalization is the
  ImageNet mean/std (YOLO: RGB 0..1; ViT: mean/std 0.5), recorded as `letterbox_rgb_v1` in checkpoints.
- Augmentation applies **only to train**. Val/test use deterministic letterboxing
  and normalization, with no augmentation, resampling or split reassignment.
- Deterministic Torch algorithms are requested with the configured seed. Results are
  not guaranteed bit-for-bit identical across devices or dependency versions.
- The Thai Motorcycle export was already stretched to 416x416 before preparation;
  this preprocessing cannot recover its original aspect ratio.

To use another prepared snapshot, change `dataset` in `experiments.yaml` (or one
model's own `dataset`), or pass `--dataset "<snapshot>"`. Pass the directory
containing COMPLETE and the manifest, **not** its classification subfolder.
Training output must stay outside that immutable snapshot.

To continue a run's weights on the same snapshot, pass
`--continue-from "<training-run>/last.pt" --epochs <additional epochs>`. It checks the
snapshot fingerprint, class order, architecture and image size, keeps the starting
model eligible as best at epoch 0, and starts a fresh optimizer in a new run; the
original checkpoint is never overwritten.

## Progress and outputs

The Terminal reports the epoch number, batches, train loss/top-1, and val
loss/top-1/macro F1. Each invocation creates a fresh ignored directory:

```text
classification/runs-class-project/train-<YYYYMMDD-HHMMSS local>-<model-name>-<6-hex id>/
  # e.g. train-20261102-230415-yolo26n-a1b2c3; held-out evaluation uses test-...
  run.json                  # exact dataset fingerprint, options, versions, status
  classes.json              # class-index mapping
  history.csv               # epoch, learning_rate, train/val metrics; flushed after each completed epoch
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
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/train.py --model <name> --evaluate-test --checkpoint "<training-run>/best.pt"
```

`.\train-classifier test <name>` selects the newest matching run with `run_state: complete` and `best.pt`;
running, interrupted, failed or unreadable runs are skipped. An explicit checkpoint path can still be used for recovery.
It writes a new `<output>/test-.../` report using that checkpoint's exact class order
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
