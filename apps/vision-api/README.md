# ParkMap Backend

One Python project with two entrypoints: the FastAPI API (`uvicorn app.main:app`) and the frame worker (`python -m app.worker`). The API serves live parking state from Postgres and the upload analysis endpoints; the worker replays a recorded video and pushes derived state to the API; all of it runs on Coolify. See [ADR 0002](../../docs/adr/0002-live-state-pipeline-and-liff-app.md) and [ADR 0005](../../docs/adr/0005-cloud-hosted-video-replay-demo.md).

## Run locally

```sh
uv venv --python 3.12 .venv
source .venv/bin/activate
uv sync --locked --all-groups
uv run uvicorn app.main:app --reload --port 8000
```

Use `PARKMAP_ALLOWED_ORIGINS` as a comma-separated list for additional frontend origins.

For tests, run `uv run python -m pytest -q tests` from this directory. CI uses Python 3.12, the committed `uv.lock`, and CPU-only PyTorch wheels on Linux/Windows. Database tests skip unless `PARKMAP_TEST_DATABASE_URL` points at a disposable database (`docker compose up -d postgres-test` from the repository root); they truncate every table.

## Live state

Copy `.env.example` to `.env`, start Postgres (`docker compose up -d postgres` from the repository root), then:

```sh
uv run python -m alembic upgrade head
uv run python -m app.manage seed-dev              # synthetic site, lot model, and calibration for development
uv run uvicorn app.main:app --reload --port 8000
uv run python -m app.manage publish-dev-state     # pushes the synthetic state every 3 s through the real ingest endpoint
```

Endpoints:

- `GET /api/sites`, `GET /api/sites/{site_id}/lot-model`, `GET /api/sites/{site_id}/parking-state`
- `POST /api/internal/parking-states`: worker ingest, requires `Authorization: Bearer $PARKMAP_WORKER_TOKEN`

An area serves regions only when its latest state is younger than `PARKMAP_STATE_FRESHNESS_S` and was produced with the active calibration version. Otherwise it reports `STALE`, `NO_DATA`, `NOT_CALIBRATED`, or `CALIBRATION_MISMATCH` without regions. Live endpoints answer `503` when `DATABASE_URL` is not set.

Real site setup:

```sh
python -m app.manage create-site --site-id <id> --name <name> --latitude <lat> --longitude <lng>
python -m app.manage create-parking-area --site-id <id> --parking-area-id <area> --camera-id <camera> --name <name>
python -m app.manage set-lot-model --site-id <id> --file <lot-model.json>
python -m app.manage register-calibration --parking-area-id <area>   # after every change to config/*.json
python -m app.manage purge-states --older-than-days 30               # schedule daily
```

Run `python -m app.manage <command> --help` for exact arguments.

Worker, on a machine that can reach the camera:

```sh
PARKMAP_API_URL=https://<api> PARKMAP_WORKER_TOKEN=<token> \
  python -m app.worker --parking-area-id <area> --source rtsp://<camera>   # or a recorded video file
```

A file source is published as `RECORDED_REPLAY` and the LIFF app says so. Raw frames never leave the worker.

After changing a Pydantic API model, run `python scripts/export_openapi.py` and regenerate the LIFF types (`pnpm --filter @parkmap/liff api:generate`). Schema changes need an Alembic revision in `migrations/versions/`; `tests/test_live_api.py` fails when tables and migrations drift.

Model weights belong at `models/best.pt` by default. ROI, homography, and row calibration files belong in `config/`. Site-specific values are intentionally not fabricated here.

## YOLO detection

### Train and evaluate a detector (Windows PowerShell)

The local public dataset is `D:\Parkmap Dataset\Kepadatan Parkir Motor.v9i.yolo26`.
It has separate `train` (1,240 images), `valid` (100), and `test` (100) folders.
Edit [detector-experiment.yaml](detector-experiment.yaml) to select a model and set
all training, evaluation, and export parameters. A `.yaml` model starts from random
weights without a download; a local `.pt` path fine-tunes existing weights. The
included five-epoch run is an initial pipeline baseline, not a tuned model.

From `D:\ParkMap\apps\vision-api`:

```powershell
# Use the project environment after uv sync --locked --all-groups.
.\.venv\Scripts\python.exe scripts\train_detector.py
```

Ultralytics prints per-epoch and batch progress in the terminal. The script checks
the dataset and labels, trains on `train`, selects `best.pt` using `valid`, then
evaluates the selected model on `valid` and the held-out `test` using the project
IoU 0.5 matching protocol. The `test` split is never passed to the trainer. It
exports the model, a three-sheet Excel report (`Summary`, per-image `Frames`, and
per-epoch `Training`), and JSON metrics to the paths in the same YAML file.
Results from this public dataset are stand-in evidence only, never real-lot accuracy.

Run names and export paths must be changed for another experiment, so earlier
results are not overwritten. Pass `--config path\to\another.yaml` to use another
configuration file. Training does not change the model currently served by the API.
For inference, `apps/vision-api/.env` is the one active backend settings file;
`.env.example` is only a template. Set `PARKMAP_MODEL_PATH` in `.env` to the selected
exported `.pt`, and set `PARKMAP_MODEL_IMGSZ`, `PARKMAP_MODEL_CONF`,
`PARKMAP_MODEL_NMS_IOU`, `PARKMAP_MODEL_CLASS_ID=0`, and `PARKMAP_DEVICE` to the
values used for that run. Use `PARKMAP_DEVICE=cpu` if the API runs without a CUDA
GPU. Start the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

The detector endpoint is `POST http://localhost:8000/api/detection/analyze`.
For the whole app, start Postgres and seed it as described in **Live state** below,
then start the LIFF app from the repository root with `pnpm --filter @parkmap/liff dev`.

`POST /api/detection/analyze` accepts a JPEG, PNG, or WebP as multipart field `image` and returns real class-0 motorcycle detections. Bounding boxes use normalized top-left coordinates (`x=left`, `y=top`). The endpoint validates file type, size, image decoding, and real dimensions.

Configure model path, input size, confidence, NMS IoU, and device with the `PARKMAP_MODEL_*` values shown in `.env.example`. The model loads on the first analysis request and is reused afterward. Health checks and calibration remain available without model weights; analysis returns `503` if weights are missing or invalid. `PARKMAP_MAX_IMAGE_PIXELS` bounds decoded image dimensions, and the image's actual format must match its declared media type.

Uploaded-image analysis also returns `503` when the required parking calibration files are missing or unreadable; configure the site before using inference results.

## Parking calibration

`GET /api/calibration` returns the saved schema-v2 calibration or `404` when calibration has not been configured. `POST /api/calibration` validates and atomically saves a normalized parking ROI plus a dynamic collection of manually drawn parking rows to `config/parking_calibration.json`.

Legacy `config/parking_roi.json` pixel coordinates are not loaded as normalized coordinates. Calibration defines the geometry consumed by the upload parking-analysis endpoint; it does not itself run inference.

The intended future pipeline is: fixed camera → YOLO detection → Parking ROI → row assignment → row projection (`t`) → metric calibration → physical occupancy footprint → occupied intervals → candidate gaps → virtual motorcycle fitting → availability states. Motorcycles inside the ROI that are currently `UNASSIGNED` must remain available to future obstruction and bad-parking analysis.
