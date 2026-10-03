# ParkMap

ParkMap is a fourth-year Sripatum University project for finding usable motorcycle parking space in an unmarked lot. Read [CONTEXT.md](CONTEXT.md) for the problem, current capabilities, and target LINE LIFF experience.

```text
ParkMap/
├── apps/liff/       # student-facing LIFF app: Next.js, 3D lot model, live regions
├── tools/calibration-ui/ # calibration and upload POC on vinext/Vite
├── apps/vision-api/ # FastAPI, YOLO, calibration, parking geometry, live state API, frame worker
├── docs/            # API contract, architecture decisions, roadmap, and agent guidance
└── .agents/         # repository agent skills
```

YOLO inference, ROI calibration, homography, dynamic physical rows, occupied geometry, free-space calculation, capacity witnesses, and parking-state decisions belong in Python. The worker pushes derived state to the API; the LIFF app only renders it. See [ADR 0002](docs/adr/0002-live-state-pipeline-and-liff-app.md) for the live pipeline and [docs/roadmap.md](docs/roadmap.md) for team tracks and milestones.

## Quick start without a camera

```sh
docker compose up -d postgres
cd apps/vision-api
cp .env.example .env                      # set PARKMAP_WORKER_TOKEN
uv sync --locked --all-groups
uv run python -m alembic upgrade head
uv run python -m app.manage seed-dev      # fake site, lot model, calibration
uv run python -m uvicorn app.main:app --reload --port 8000
uv run python -m app.manage publish-dev-state      # second terminal
cd ../liff && cp .env.example .env.local && pnpm dev   # http://localhost:3001
```

The seeded data is synthetic, and the LIFF app labels it as such.

## LIFF app

```sh
pnpm install --frozen-lockfile
pnpm dev:liff
```

Open <http://localhost:3001>. After changing a Pydantic API model, run `python scripts/export_openapi.py` in `apps/vision-api`, then `pnpm --filter @parkmap/liff api:generate`. CI fails when either generated file is stale.

## Calibration POC (tools/calibration-ui)

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. The dashboard can analyze an uploaded image through the backend and display the Physical Map and camera overlay.

## Backend

```sh
cd apps/vision-api
uv venv --python 3.12 .venv
uv sync --locked --all-groups
uv run python -m uvicorn app.main:app --reload --port 8000
```

Endpoints:

- Health: <http://localhost:8000/api/health>
- Live parking state: `GET /api/sites/{site_id}/parking-state`; see [apps/vision-api/README.md](apps/vision-api/README.md) for the worker, database, and management commands.
- Image analysis: `POST http://localhost:8000/api/detection/analyze` with multipart field `image`
- Metric calibration: `GET/POST http://localhost:8000/api/metric-calibration`
- API docs: <http://localhost:8000/docs>

Run the web app and API in separate terminals. Local CORS permits `http://localhost:3000`; additional origins can be configured through the API environment.

## Checks

```sh
pnpm --filter @parkmap/calibration-ui lint
pnpm --filter @parkmap/calibration-ui typecheck
pnpm --filter @parkmap/calibration-ui test
pnpm --filter @parkmap/calibration-ui build
pnpm --filter @parkmap/liff lint
pnpm --filter @parkmap/liff typecheck
pnpm --filter @parkmap/liff test
pnpm --filter @parkmap/liff build
cd apps/vision-api
uv sync --locked --all-groups
docker compose up -d postgres-test
PARKMAP_TEST_DATABASE_URL=postgresql://parkmap:parkmap@localhost:5433/parkmap_test uv run python -m pytest -q tests
```

Database tests skip without `PARKMAP_TEST_DATABASE_URL`, and they truncate that database. CI runs the web and LIFF jobs, then the Python job against a Postgres 17 service. JavaScript versions shared by future packages belong in the pnpm catalog. The Vision API requires CPython 3.12; its direct dependencies and development group are declared in `apps/vision-api/pyproject.toml`, and `apps/vision-api/uv.lock` is authoritative for CI and local development. Regenerate the lock intentionally with `uv lock`, then verify installation with `uv sync --locked --all-groups`. CI layout is adapted from Showcase for ParkMap's runtimes.

The detection endpoint runs the configured YOLO model and returns normalized top-left motorcycle bounding boxes. Upload analysis then applies the active parking calibration, homography, physical row dimensions, occupied/free geometry, capacity, and parking-state validation.

## Setup workflow

The Setup page uses one reference image and two editing modes:

1. **Parking Area** — draw the Parking ROI and any number of rows (R1–Rn), then edit physical row dimensions in the collapsed dimensions panel.
2. **Ground Map Calibration** — edit the P1–Pn ground-control points and calculate/update the homography.

Switching modes changes the visible editor while keeping the same reference image. Row IDs are dynamic and may be sparse (for example `row_1`, `row_2`, `row_4`).

## Future Site Measurement Checklist

- Measure the usable physical length and width of every configured parking row separately.
- Measure useful Parking ROI boundary/reference segments and record their exact endpoints.
- Collect additional known, non-collinear ground points and surveyed coordinates if accurate 2D image-to-ground calibration is required.

Do not estimate missing values from pixels, motorcycles, painted lines, maps, or generic vehicle dimensions. These measurements will later connect normalized row position `t` to longitudinal position through `s = t × measured row length`; they do not by themselves establish complete 2D metric geometry.

## Estimated and measured metric values

- `ESTIMATED` values are temporary approximations entered manually for development and workflow testing. They are not verified site measurements.
- `MEASURED` values are values the user physically measured at the parking site.

Measured physical row dimensions are edited from Setup and saved with the ground-plane calibration. They are used with the validated homography to derive physical row geometry; they do not replace the ground-control points required for a 2D map.

## ParkMap Branding

Logo file:

`tools/calibration-ui/public/branding/parkmap-logo.png`

Use a PNG with a transparent background and keep the filename exactly `parkmap-logo.png`. Copy or replace that file to update the header logo, then refresh the page; restart or rebuild the frontend if the development or deployed build has cached the previous asset. If the file is missing or cannot load, the header safely keeps the existing ParkMap icon and text without showing a broken image.

For a future favicon or app icon, first create a dedicated square/cropped variant suited to small sizes. Do not use the full logo blindly when its aspect ratio or detail is unsuitable.
