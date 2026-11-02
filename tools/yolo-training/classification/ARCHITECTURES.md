# Comparing classifier architectures

The trainer and the local Parking experiment support `resnet18`,
`efficientnet_b0` and the [YOLO11n-cls trial](YOLO-CLASSIFICATION.md).
This does not change the YOLO detector or parking decisions.

Run from the repository root (PowerShell):

```powershell
apps/vision-api/.venv/Scripts/python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.efficientnet.json --validate-only
apps/vision-api/.venv/Scripts/python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.efficientnet.json --patience 8
```

The config pins the replay snapshot: 1,153 train crops, 251 validation crops and
247 held-out test crops, with 46 output families. If moving to another machine,
copy that immutable snapshot or explicitly supply its new path with `--dataset`.
Training never evaluates the held-out test. Output uses a new run directory;
existing models and snapshots are preserved.

To continue the interrupted EfficientNet weights without changing its snapshot:

```powershell
apps/vision-api/.venv/Scripts/python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.efficientnet.json --continue-from tools/yolo-training/classification/runs/train-20261102T132332Z-b12b0e59/last.pt --epochs 48 --patience 8
```

`--continue-from` verifies the checkpoint's snapshot fingerprint, manifest, class
order, architecture and image size. It keeps the starting model eligible as best
at local epoch 0. The old checkpoint has no optimizer or random-generator state,
so this is continuation of weights with a fresh optimizer and seed, not exact
resume. Epoch numbers restart in a new run; metadata records `continued_from_epoch`
and `optimizer_restored=false`. `--epochs` means additional epochs, not the total
including the earlier run. The original checkpoint is never overwritten.

EfficientNet starts from Torchvision's official ImageNet-1K V1 weights and trains
the classifier head only. The backbone, including BatchNorm running statistics,
stays frozen. Its classifier dropout remains active during training. The first
run downloads weights to the ignored `weights/checkpoints/` directory. For offline
use, `--initial-weights` accepts an original Torchvision state dict matching the
selected architecture, before replacing its ImageNet head. A ParkMap warm-start
checkpoint must match architecture, image size, and the validated parent lineage;
a ResNet18 checkpoint cannot initialize EfficientNet.

The experiment uses 224-pixel letterboxing with the recorded ParkMap normalization
and training-only flip/color augmentation. It preserves the crop aspect ratio;
it does not use the pretrained model's original center-crop evaluation recipe.
Published ImageNet accuracy is therefore not a ParkMap accuracy claim. See
[Torchvision EfficientNet-B0](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.efficientnet_b0.html).

Settings: batch 16, AdamW learning rate 0.001, seed 20261102, at most 50 epochs,
early stopping after 8 epochs without improved validation Macro F1. The checkpoint
with highest Macro F1 is kept (lower validation loss breaks ties).

Compare against ResNet18 replay run `train-20261102T122913Z-d6c7baaa` on the exact
same validation identities. That run used a trained ParkMap parent and learning
rate 0.0001, whereas this EfficientNet trial starts from ImageNet at 0.001.
This is an exploratory comparison of training recipes, not an isolated estimate
of the architecture's effect. A controlled architecture comparison requires
training both from ImageNet with a predeclared common tuning budget. Do not select
hyperparameters using held-out test results.

The dataset remains provisional: proposed similar-image pairs and unconfirmed
vehicle identities can still affect generalization. Validation results are not
evidence of accuracy on the real parking camera. Completed runs appear in Parking
with architecture, run ID and best epoch; training-in-progress runs stay hidden.

## Recorded continuation result

Run `train-20261102T133556Z-cef86fca` continued the interrupted epoch-2 weights
with a fresh optimizer. It completed 24 additional epochs and stopped after eight
without improved Macro F1. Its best local epoch is 16 (18 completed training
epochs including the original two). On the same 251 validation crops:

- ResNet18 replay: 182/251 correct (72.51%), Macro F1 0.63947.
- EfficientNet-B0 continuation: 196/251 correct (78.09%), Macro F1 0.68023.
- Original-source subset: 158/222 versus 171/222 correct.
- Honda2 subset: 24/29 versus 25/29 correct.

Original checkpoint hashes were unchanged. The completed model was discovered
and loaded by the Parking API; a real validation crop prediction matched the
saved evaluation. No held-out test evaluation was performed. The comparison and
dataset limitations above still apply; the trial does not isolate architecture
from training history or establish real-camera accuracy.
