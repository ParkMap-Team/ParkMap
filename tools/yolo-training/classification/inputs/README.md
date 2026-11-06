# classification/inputs

Source dataset archives (ZIP exports from Roboflow) that `prepare.py` reads to build classification crops.
Git-ignored; keep the archives byte-identical to the downloaded originals.

| File | Used by |
| --- | --- |
| `Thai Motorcycle.v1-top1k.yolo26.zip` | default source of `prepare.py` (46 model-family classes, CC BY 4.0) |

Add another archive either by dropping it here or by passing it directly:

```powershell
uv run --project apps/vision-api --no-sync python tools/yolo-training/classification/prepare.py --source "<name>=<absolute-path-to-zip>"
```

Nothing here is modified by the scripts. Details: [../README.md](../README.md), audit notes: [../AUDIT.md](../AUDIT.md).
