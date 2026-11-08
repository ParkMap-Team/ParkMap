# YOLO training

Two separate jobs, each with its own folder, single settings file, menu and run outputs:

| Folder | Job | Entry point | Settings |
| --- | --- | --- | --- |
| [`detection/`](detection/README.md) | find every motorcycle in a parking photo (boxes) | `.\train-detector` | `detection/config.yaml` |
| [`classification/`](classification/README.md) | name the model family of a cropped motorcycle | `.\train-classifier` | `classification/experiments.yaml` ([training](classification/TRAINING.md)) |

Shared, Git-ignored folders:

- `datasets/`: Label UI exports and private photo sets used by detection (and as sources for classification crops)
- `.venv-gpu/`: CUDA environment made by `.\train-classifier setup`, used by both entry points
