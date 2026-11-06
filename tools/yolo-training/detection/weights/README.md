# detection/weights

COCO-pretrained starting weights (`yolo26s.pt`, `yolo11s.pt`, ...) that `train.py` downloads the first time a model
from [`../config.yaml`](../config.yaml) is trained. Git-ignored; the location is set by `weights_dir` in the config.

These are generic starting points, **not** ParkMap-trained detectors; trained checkpoints are in
[`../runs/<model>/round-.../weights/`](../runs/README.md). Deleting this folder is safe; files download again (internet needed).
