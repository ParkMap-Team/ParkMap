# classification/runs

Outputs of `.\train-classifier run` / `test`. Git-ignored (contains private crops and weights).

| Item | Meaning |
| --- | --- |
| `summary.csv` | one row per finished training run: model, best epoch, settings, val top-1, val macro-F1, val loss |
| `train-<YYYYMMDD>-<HHMMSS>-<model>-<id>/` | one training run |
| `test-<YYYYMMDD>-<HHMMSS>-<architecture>-<id>/` | one held-out test evaluation |
| `*.xlsx`, `Summary.zip` | evaluation reports exported by hand for presentations; not written by the scripts |

A training folder holds `run.json` (exact settings, dataset fingerprint, versions, status), `classes.json`, `history.csv`
(one row per epoch), `best.pt` (chosen by val macro-F1), `last.pt` and `val/` (`metrics.json`, `confusion_matrix.csv`,
`predictions.jsonl`, `mistakes.html`). A test folder holds the same report files for the test split.

**Do not rename or move training folders**: the API's Parking page loads `runs/<folder>/best.pt` by folder name
(`apps/vision-api/app/classifier.py`). Use val to choose a model and run `test` once afterwards.
Details: [../TRAINING.md](../TRAINING.md).
