# ParkMap Backend

One Python project with two entrypoints: the FastAPI API (`uvicorn app.main:app`) and the frame worker (`python -m app.worker`). The API serves live parking state from Postgres and the upload analysis endpoints; the worker replays a recorded video and pushes derived state to the API; all of it runs on Coolify. See [ADR 0002](../../docs/adr/0002-live-state-pipeline-and-liff-app.md) and [ADR 0005](../../docs/adr/0005-cloud-hosted-video-replay-demo.md).

## Run locally

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Use `PARKMAP_ALLOWED_ORIGINS` as a comma-separated list for additional frontend origins.

For tests, install `requirements-dev.txt` and run `python -m pytest -q tests` from this directory. CI uses the pinned `requirements-dev.lock` and CPU-only PyTorch through uv. Database tests skip unless `PARKMAP_TEST_DATABASE_URL` points at a disposable database (`docker compose up -d postgres-test` from the repository root); they truncate every table.

## Live state

Copy `.env.example` to `.env`, start Postgres (`docker compose up -d postgres` from the repository root), then:

```sh
python -m alembic upgrade head
python -m app.manage seed-dev              # synthetic site, lot model, and calibration for development
python -m uvicorn app.main:app --reload --port 8000
python -m app.manage publish-dev-state     # pushes the synthetic state every 3 s through the real ingest endpoint
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

`POST /api/detection/analyze` accepts a JPEG, PNG, or WebP as multipart field `image` and returns real class-0 motorcycle detections. Bounding boxes use normalized top-left coordinates (`x=left`, `y=top`). The endpoint validates file type, size, image decoding, and real dimensions.

Configure model path, input size, confidence, NMS IoU, and device with the `PARKMAP_MODEL_*` values shown in `.env.example`. The model loads on the first analysis request and is reused afterward. Health checks and calibration remain available without model weights; analysis returns `503` if weights are missing or invalid. `PARKMAP_MAX_IMAGE_PIXELS` bounds decoded image dimensions, and the image's actual format must match its declared media type.

Uploaded-image analysis also returns `503` when the required parking calibration files are missing or unreadable; configure the site before using inference results.

## Parking calibration

`GET /api/calibration` returns the saved schema-v2 calibration or `404` when calibration has not been configured. `POST /api/calibration` validates and atomically saves a normalized parking ROI plus a dynamic collection of manually drawn parking rows to `config/parking_calibration.json`.

Legacy `config/parking_roi.json` pixel coordinates are not loaded as normalized coordinates. Calibration defines the geometry consumed by the upload parking-analysis endpoint; it does not itself run inference.

## Metric calibration

`GET /api/metric-calibration` returns `NOT_CALIBRATED` when no physical measurements have been saved. `POST /api/metric-calibration` validates and atomically stores dynamic row dimensions and ground-control data in the separate ignored file `config/metric_calibration.json`. Every measured row ID must currently exist in Parking Calibration; sparse dynamic IDs are supported. Dimensions use meters internally and are treated as measured site values by the current Setup workflow.

### Future Site Measurement Checklist

- Measure the real usable length and width of every configured row.
- Record useful Parking ROI boundary distances as identifiable reference segments.
- Photograph or mark the exact endpoints used for every measured segment.
- For accurate future 2D ground-plane calibration, collect additional non-collinear ground-control points with normalized image locations and surveyed ground coordinates.

The intended future pipeline is: fixed camera → YOLO detection → Parking ROI → row assignment → row projection (`t`) → metric calibration → physical occupancy footprint → occupied intervals → candidate gaps → virtual motorcycle fitting → availability states. Motorcycles inside the ROI that are currently `UNASSIGNED` must remain available to future obstruction and bad-parking analysis.
