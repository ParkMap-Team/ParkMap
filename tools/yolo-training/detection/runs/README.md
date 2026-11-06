# detection/runs

Outputs of `.\train-detector run` / `test`. Git-ignored (contains weights and private plots).

```
history.csv                         one row per run: status, minutes, epochs, imgsz, batch, best epoch, val mAP
<model>/round-NN_<YYYY-MM-DD>_<HH-MM>/
  train.log                         everything printed during training, including errors and tracebacks
  summary.json                      status, environment, dataset hashes, settings, best epoch, val metrics,
                                    checkpoint SHA-256; gets a "test" block after evaluation
  config_used.yaml                  copy of ../config.yaml at the start of the run
  data.yaml                         dataset file passed to Ultralytics
  results.csv, *.png, *.jpg         Ultralytics per-epoch metrics, curves and sample batches
  weights/best.pt, weights/last.pt  best by val mAP50-95, and the last epoch
  test/, test.log                   only after `.\train-detector test` (allowed once per run)
```

`NN` counts every earlier run of the same model, so `yolo26s/round-03_...` is the third yolo26s run.
Folder names are read by `train.py --test`; do not rename them. Copying a `best.pt` into `apps/vision-api/models/`
is a separate, reviewed step. Details: [../README.md](../README.md#outputs-and-logs).
