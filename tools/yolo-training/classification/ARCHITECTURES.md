# Classifier architectures

The trainer and the local Parking experiment support these architectures. Choose them per model in
[experiments.yaml](experiments.yaml); this does not change the YOLO detector or parking decisions.

| `architecture` | Pretrained start | Notes |
| --- | --- | --- |
| `resnet18` | Torchvision ImageNet-1K V1 | simple baseline |
| `efficientnet_b0` | Torchvision ImageNet-1K V1 | classifier dropout stays active during training |
| `mobilenet_v3_large` | Torchvision ImageNet-1K | fast CPU inference |
| `convnext_tiny` | Torchvision ImageNet-1K | largest; strongest on fine-grained classes so far |
| `yolo11<n,s,m,l,x>_cls`, `yolo26<n,s,m,l,x>_cls` | Ultralytics ImageNet classification weights | logits and RGB 0..1 normalization recorded in the checkpoint |
| `yolo12<n,s,m,l,x>_cls` | none published | needs `fine_tune: true`; trains the whole network from scratch |

With `fine_tune: false` only the new classifier head trains; the backbone, including BatchNorm running statistics,
stays frozen. The first run downloads weights to the ignored `weights/checkpoints/` directory. For offline use,
`--initial-weights` accepts an original ImageNet state dict matching the selected architecture, before its head is
replaced. `--continue-from` accepts only a ParkMap checkpoint of the same architecture, image size and snapshot.

All models use the recorded ParkMap letterbox preprocessing (224 px by default), preserving the crop aspect ratio
instead of the pretrained models' original center-crop recipe. Published ImageNet accuracy is therefore not a
ParkMap accuracy claim.

A fair architecture comparison trains each model from ImageNet on the same snapshot with the same settings and
compares val macro-F1 in `runs/summary.csv`; choose by val, then run `test` once. Completed runs appear in Parking
with architecture, run ID and best epoch; runs still training stay hidden.
