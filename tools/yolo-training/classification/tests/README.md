# classification/tests

Automated checks for the classification tools. They use tiny synthetic data, never download weights or train a real model.

| File | Checks |
| --- | --- |
| `test_prepare.py` | `prepare.py` on synthetic archives: crops, splits, fingerprints, verification |
| `test_review_workspace.py` | review staging never creates train/val/test samples |
| `test_merge_reviewed.py` | merging reviewed snapshots keeps pending labels out and removes duplicates |
| `test_training.py` | `train.py`: snapshot validation, one-file config and menu, run names, every architecture offline, checkpoints, reports, `summary.csv` |
| `test_transfer.py` | transfer training keeps the parent's held-out splits and class catalog |
| `test_gallery.mjs` | offline review gallery in a real browser (Node) |

Run from the repository root:

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/classification/tests -v
node tools/yolo-training/classification/tests/test_gallery.mjs
```
