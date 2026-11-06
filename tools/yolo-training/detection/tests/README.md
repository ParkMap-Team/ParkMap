# detection/tests

Automated checks for detector training. They use temporary synthetic images and never load YOLO, download weights or train.

| File | Checks |
| --- | --- |
| `test_terminal.py` | `dataset_check.py` rules (session leakage, missing val), `train.py --check`, shipped `config.yaml` (5+ described models), round-numbered run folders, run logs keep output and tracebacks |
| `test_notebook.py` | helper functions inside the Colab notebook (validation, IoU, matching) without running Colab |

Run from the repository root:

```powershell
uv run --project apps/vision-api --no-sync python -m unittest discover -s tools/yolo-training/detection/tests -v
```
