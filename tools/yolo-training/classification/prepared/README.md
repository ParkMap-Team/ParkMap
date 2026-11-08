# classification/prepared

Prepared classification datasets made by `prepare.py` from the archives in [`../inputs/`](../inputs/README.md).
Git-ignored because the crops are private.

| Item | Meaning |
| --- | --- |
| `index.html` | offline gallery of the current snapshot; open by double-click |
| `latest.json` | pointer to the current snapshot and its status (`provisional` until review is complete) |
| `run-<fingerprint>/` | one **immutable** snapshot; different inputs, review or code give a new fingerprint |

A complete snapshot contains `COMPLETE`, `REPORT.md` (audit and per-class coverage), `classification/` (train/val/test
crops), `manifest.jsonl`, `integrity.json`, `reproducibility.json`, audit and review JSON files and `index.html`.
A folder without `COMPLETE` was interrupted and is never reused.

Training reads the snapshot named by `dataset` in [`../experiments.yaml`](../experiments.yaml), not `latest.json`,
so a new preparation never changes an existing experiment. Check a snapshot before training:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --verify "tools/yolo-training/classification/prepared/run-<fingerprint>"
```

Never edit files inside a snapshot; prepare a new one instead. Details: [../README.md](../README.md).
