# classification/weights

Pretrained starting weights downloaded on the first real training run. Git-ignored.

`checkpoints/` holds the original ImageNet weights: ConvNeXt-Tiny, EfficientNet-B0, MobileNetV3-Large, ResNet18
(Torchvision `.pth`) and YOLO11n-cls / YOLO26n-cls (Ultralytics `.pt` plus extracted `*-imagenet-state.pth`).

These are **not** ParkMap-trained models; those are `best.pt` files in [`../runs/`](../runs/README.md).
Deleting this folder is safe: the next run downloads the files again (internet needed). For offline training pass
`--initial-weights <file>`; see [../TRAINING.md](../TRAINING.md) and [../YOLO-CLASSIFICATION.md](../YOLO-CLASSIFICATION.md).
