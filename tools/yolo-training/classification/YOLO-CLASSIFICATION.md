# YOLO11n classification trial

This is a classifier of existing motorcycle crops, separate from YOLO detection.
It uses Ultralytics 8.4.166's YOLO11n-cls architecture and official ImageNet weights.
It runs through ParkMap's PyTorch training loop, not `YOLO.train()`.

From the repository root:

```powershell
apps/vision-api/.venv/Scripts/python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.yolo11n.json --validate-only
apps/vision-api/.venv/Scripts/python.exe tools/yolo-training/classification/train.py --config tools/yolo-training/classification/training.yolo11n.json --patience 8
```

The immutable replay snapshot, seed 20261102, 224-pixel input, batch 16, AdamW
learning rate 0.001, training-only flip/color augmentation, maximum 50 epochs and
8-epoch validation Macro F1 patience match the declared EfficientNet trial recipe.
Only the final linear classifier is trained; all convolution and BatchNorm
parameters/statistics, including those in the YOLO classification head, stay frozen.
YOLO evaluation returns both probabilities and logits; the adapter uses logits for
cross entropy and applies softmax only once for prediction scores.

Images retain their whole crop through ParkMap's bilinear letterboxing. YOLO uses
its native zero mean/unit std normalization (RGB 0..1); Torchvision classifiers
retain their recorded ImageNet mean/std. The checkpoint records this difference.
This avoids the center/random crops used by the default Ultralytics classification
pipeline, which can remove motorcycle details. See the
[official classification guide](https://docs.ultralytics.com/tasks/classify/).

The fixed official release asset downloads under ignored `weights/checkpoints/`.
It is loaded once with Ultralytics to extract an original state dict. Subsequent
training/continuation and generated ParkMap checkpoints use tensor state dicts
with `weights_only=True`; no uploaded pickled model is accepted. Local original
state dicts can be supplied with `--initial-weights` for offline use.

Outputs use a new ignored `runs/train-*` directory. Validation has the same 251
identities as EfficientNet run `train-20261102T133556Z-cef86fca`, whose best result
was 196/251 (78.09%), Macro F1 0.68023. Neither run uses held-out test for model
selection. The dataset remains provisional due to unresolved near-image/vehicle
identity checks. Differences in pretrained weights, normalization, head dropout
and the EfficientNet continuation's fresh optimizer mean this is a recipe
comparison, not an isolated architecture effect or real-camera accuracy claim.

Completed YOLO11n-cls runs appear alongside ResNet18 and EfficientNet-B0 in the
local Parking model selector. Press Analyze to detect once and classify the crops
with the selected model. The API rebuilds the classifier without downloading any
weights and loads the hash-verified tensor state dict, retaining the recorded
normalization and using logits for scores. It does not replace detector weights,
worker behavior or LIFF parking decisions.

## Recorded result

Run `train-20261102T144223Z-c747fdab` stopped after 20 epochs and selected epoch
12 by validation Macro F1. Exact validation annotation IDs, truth labels, snapshot
fingerprint and manifest hash matched the EfficientNet comparison run.

- EfficientNet-B0: 196/251 correct (78.09%), Macro F1 0.68023.
- YOLO11n-cls: 195/251 correct (77.69%), Macro F1 0.72162.
- Original source: EfficientNet 171/222, YOLO 173/222 correct.
- Honda2 source: EfficientNet 25/29, YOLO 22/29 correct.
- YOLO alone was correct on 20 images; EfficientNet alone was correct on 21.

YOLO had higher Macro F1 while EfficientNet had one more correct prediction.
These exploratory results do not establish a general winner. Both checkpoint
hashes were verified, and a freshly loaded YOLO checkpoint reproduced a saved
validation prediction/score. Held-out test was not evaluated. The recorded
comparison is in the ignored run's `comparison-efficientnet.json`.
