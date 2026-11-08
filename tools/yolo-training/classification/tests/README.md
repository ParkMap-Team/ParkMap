# classification/tests

Automated checks for the classification tools. They use tiny synthetic data, never download weights or train a real model.

| File | Checks |
| --- | --- |
| `test_prepare.py` | `prepare.py` on synthetic archives: crops, splits, fingerprints, verification |
| `test_training.py` | `train.py`: snapshot validation, one-file YAML config and menu, balanced sampling, early stopping, run names, every architecture offline, checkpoints, reports, `summary.csv` |
| `test_gallery.mjs` | offline review gallery in a real browser (Node) |

Run from the repository root:

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/classification/tests -v
node tools/yolo-training/classification/tests/test_gallery.mjs
```
