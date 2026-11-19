> Current motorcycle settings: required inside LIFF, verified through LINE Login. OA chat settings are retired. See [the settings runbook](../../docs/line-motorcycle-settings.md) and ADR 0019.

# ParkMap Backend

One Python project with separate API (`uvicorn app.main:app`), frame worker (`python -m app.worker`), and optional LINE bot (`uvicorn app.line_bot:app`) entrypoints. The API serves parking state and upload analysis; the worker pushes derived state; the bot handles the requested account-specific motorcycle settings conversation. Only the bot gets Messaging API credentials and public webhook routes. See [ADR 0002](../../docs/adr/0002-live-state-pipeline-and-liff-app.md), [ADR 0005](../../docs/adr/0005-cloud-hosted-video-replay-demo.md), and the [LINE settings runbook](../../docs/line-motorcycle-settings.md).

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

An area serves regions only when its latest state is younger than `PARKMAP_STATE_FRESHNESS_S` and was produced with the active calibration version. Age counts from `observed_at`, except for a still-image loop, which counts from `processed_at` and reports `DEMO` instead of `LIVE`. Otherwise it reports `STALE`, `NO_DATA`, `NOT_CALIBRATED`, or `CALIBRATION_MISMATCH` without regions. Live endpoints answer `503` when `DATABASE_URL` is not set.

Real site setup:

The local Calibration UI lot-model editor uses protected `/api/operator/lot-model`
endpoints: template/validation, site draft GET/PUT, and explicit activation POST.
`PARKMAP_EDITOR_TOKEN` is separate from the worker token and stays on the servers.
Without it authoring is disabled (503); an invalid token returns 401. Draft writes
carry `expected_revision` and `base_version`, and activation accepts only the saved
revision. Conflicts return 409. Migration `0003_lot_model_drafts` stores drafts
separately; public LIFF endpoints continue to serve only the active model.
ROI polygons can be edited, but must remain valid, non-overlapping and inside the
lot outline, and refer to registered site areas, including after rotation. For a single-area model, the
operator can explicitly set the lot outline to the exact ROI polygon; the editor
accepts that outline as well as existing template/active/draft outlines. A rigid
move/rotation preserves calibration: the public state endpoint maps every region
ring, motorcycle centre and heading from the ROI stored in the active calibration
to the active lot polygon. The API accepts only a rotation/translation matching all
vertices within 0.000001 m and keeps physical dimensions, timestamps and semantics.
Resizing/reshaping deactivates calibration atomically; an incompatible registered
calibration returns `CALIBRATION_MISMATCH` without geometry. Review image ROI, rows
and metric mapping before registering changed calibration.
Saving a draft or changing landmarks alone does not deactivate calibration.

```sh
python -m app.manage create-site --site-id <id> --name <name> --latitude <lat> --longitude <lng>
python -m app.manage create-parking-area --site-id <id> --parking-area-id <area> --camera-id <camera> --name <name>
python -m app.manage set-lot-model --site-id <id> --file <lot-model.json>
python -m app.manage register-calibration --parking-area-id <area>   # after every change to config/*.json
python -m app.manage purge-states --older-than-days 30               # schedule daily
python -m app.manage remove-site --site-id <id> --confirm <id>       # deletes the site and everything it owns
```

Run `python -m app.manage <command> --help` for exact arguments. The Sripatum demo site and its calibration are described in [docs/sripatum-measured-calibration.md](../../docs/sripatum-measured-calibration.md).

Data migration `0004_sripatum_setup` seeds the explicitly shared active setup into
a database without that site. Existing site data is preserved. See
[shared setup migration](../../docs/site-setup-data-migration.md) for restoring
matching worker calibration files without overwriting local files.

Worker, on a machine that can reach the camera:

```sh
PARKMAP_API_URL=https://<api> PARKMAP_WORKER_TOKEN=<token> \
  python -m app.worker --parking-area-id <area> --source rtsp://<camera>   # or a recorded video file or photo directory
```

A file source is published as `RECORDED_REPLAY`; the LIFF app does not label it (see Source wording in `CONTEXT.md`). A directory source is a still-image loop published as `STILL_IMAGE_LOOP` ([ADR 0011](../../docs/adr/0011-still-image-loop-demo-on-estimated-calibration.md)): photos are named `YYYYMMDD_HHMM[SS]...` after their local capture time (`--photo-utc-offset`, default `+07:00`), must match the calibration reference size, and each is held for `--hold-s` seconds (default 10). Calibration inputs may be `ESTIMATED`; a live camera on an estimated calibration reports every region `UNKNOWN`. Raw frames never leave the worker.

After changing a Pydantic API model, run `python scripts/export_openapi.py` and regenerate the LIFF types (`pnpm --filter @parkmap/liff api:generate`). Schema changes need an Alembic revision in `migrations/versions/`; `tests/test_live_api.py` fails when tables and migrations drift.

Model weights belong at `models/best.pt` by default. ROI, homography, and row calibration files belong in `config/`. Site-specific values are intentionally not fabricated here.

## YOLO detection

`POST /api/detection/analyze` accepts a JPEG, PNG, or WebP as multipart field `image` and returns real class-0 motorcycle detections. Bounding boxes use normalized top-left coordinates (`x=left`, `y=top`). The endpoint validates file type, size, image decoding, and real dimensions.

Configure model path, input size, confidence, NMS IoU, and device with the `PARKMAP_MODEL_*` values shown in `.env.example`. The model loads on the first analysis request and is reused afterward. Health checks and calibration remain available without model weights; analysis returns `503` if weights are missing or invalid. `PARKMAP_MAX_IMAGE_PIXELS` bounds decoded image dimensions, and the image's actual format must match its declared media type.

Uploaded-image analysis also returns `503` when the required parking calibration files are missing or unreadable; configure the site before using inference results.

## Parking calibration

`GET /api/calibration` returns the saved schema-v2 calibration or `404` when calibration has not been configured. `POST /api/calibration` validates and atomically saves a normalized parking ROI plus a dynamic collection of manually drawn parking rows to `config/parking_calibration.json`.

Legacy `config/parking_roi.json` pixel coordinates are not loaded as normalized coordinates. Calibration defines the geometry consumed by the upload parking-analysis endpoint; it does not itself run inference.

The intended future pipeline is: fixed camera → YOLO detection → Parking ROI → row assignment → row projection (`t`) → metric calibration → physical occupancy footprint → occupied intervals → candidate gaps → virtual motorcycle fitting → availability states. Motorcycles inside the ROI that are currently `UNASSIGNED` must remain available to future obstruction and bad-parking analysis.

### Segmentation worker

The worker now uses `PARKMAP_SEGMENTATION_MODEL_PATH` and the same Seg row-association
policy as Parking Analyze. Restart the worker after changing weights or code.

For the local Sripatum guard-booth preview, start the API with
`PARKMAP_GUARD_BOOTH_FIT_PREVIEW=1` and run the still-image worker. The
`guard-booth-fit` endpoint tests a classified family's reference width against
a current recorded Segment band; length never rejects a fit, and a frame longer
than the row is drawn at the band depth. A successful request ID holds
its sample frame in the local API process for two minutes, so another request
cannot receive overlapping space. The route is for inspection and the preview
hold ends on API restart.

The same recorded preview may be enabled in a deployed environment by setting
`PARKMAP_GUARD_BOOTH_FIT_PREVIEW=1` on the API and LIFF at runtime. The page uses
the site's existing still-image worker and calibration. Open
`/sites/sripatum/guard-booth?preview=known` to run it.

With `PARKMAP_GUARD_BOOTH_CLIP_PATH` also set to a local `.mp4` or `.webm` of
at most 180 s (operator uploads stay capped at 30 s), the
Guard Booth page without `?preview=` plays that entrance clip in a panel beside
the parking map, once per still-image photo: the next photo restarts it (see
Entrance clip in `CONTEXT.md`). Run the worker with `--hold-s` at least the clip
length plus the 4 s poll and the worker's analysis time, for example
`--hold-s 25` for a 17.3 s clip; a shorter hold cuts the clip short. `guard-booth-clip` serves the file with Range support.
The API runs the Classify Video detector, tracker and ConvNeXt on it at 5
sampled fps in the background from startup, because that takes minutes on a
server CPU, and caches the track evidence in memory until the file or classifier
changes. Until then `guard-booth-classification` answers 503 with `Retry-After`,
and the page keeps preparing the camera and asks again; a 503 without it is a
setup failure. Once tracked, it returns the clip's riders in arrival order. A rider is a track
with at least `MIN_OBSERVATIONS` observations whose ground point (bottom centre
of its box) ends at least 0.15 of the frame away from where it started, so a
motorcycle parked in view is not a rider. Its `arrival_s` is when that ground
point first enters `PARKMAP_GUARD_BOOTH_CLIP_ZONE` (`left,top,right,bottom`
fractions of the frame; the whole frame when unset). The page queues each rider
as the clip reaches its arrival (at most three, each for 30 seconds) and fits it
on the map with its own request ID, so riders close together get separate holds.
Those requests set `ends_with_photo`, so their holds end when the area shows another photo.
A classified family with a reference size in
`config/motorcycle_reference_sizes.json` gets a fitted frame; a family without
one is named but gets no placement until its size is added. A detector with COCO-pretrained weights sets
`PARKMAP_VIDEO_DETECTOR_CLASS_ID=3`; unset, the video detector uses
`PARKMAP_MODEL_CLASS_ID`. The clip is stand-in data and supports no accuracy
claim. The production image ships no classifier weights, so there the
classification returns `503` and the page shows an unknown model.
It publishes standard-size motorcycle proxies only for assigned Seg detections.
The current analysis checks width only, so all published row regions remain
`UNKNOWN`; width-preview green/yellow is never promoted to LIFF availability.
Missing weights do not fall back to the original detector. Calibration fingerprint,
recorded-photo timestamps, freshness, and source notices remain unchanged.

Width previews now publish as `WIDTH_SUFFICIENT`, not `AVAILABLE`. LIFF renders
them light green with a width-only warning and the original uncertainty reasons.
This carries no proof of vehicle length or access, and does not clear occlusion.

Seg worker publication separates `OCCUPIED` row bands from motorcycle proxies.
Red/green region geometry matches the operator gap map. Horizontal-image
hypotheses in calibrated ROI display as horizontal standard-size proxies, even
without an owner row, without feeding fitting or clearing uncertainty.
