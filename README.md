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
uv run uvicorn app.main:app --reload --port 8000
uv run python -m app.manage publish-dev-state      # second terminal
cd ../liff && cp .env.example .env.local && pnpm dev   # http://localhost:3001
```

The seeded data is synthetic, and the LIFF app labels it as such.

## Windows launcher

Double-click `start-dev.bat` at the repository root, or run it from a terminal:

```bat
start-dev.bat
start-dev.bat --demo
start-dev.bat --no-browser
start-dev.bat --dry-run
```

Before the first run, open Docker Desktop, install frontend dependencies with
`corepack pnpm install --frozen-lockfile`, and run `uv sync --locked --all-groups`
in `apps/vision-api`. Copy that package's `.env.example` to `.env`; set
`PARKMAP_WORKER_TOKEN` if using `--demo`. The launcher uses pnpm when available,
otherwise npm runs each package's already-installed `dev` script. It does not
download a package manager, install dependencies, or change the pnpm lockfile.

The launcher starts only the development Postgres service, waits for its healthcheck,
runs migrations, and opens separate terminals for database logs, Vision API (8000),
LIFF (3001), and Calibration UI (3000). It then opens the two web apps and API docs
in the browser, unless `--no-browser` is supplied. Progress messages identify each
startup step. It works from any directory,
checks for occupied app ports, and uses the compose database on `127.0.0.1:5432` and
the API on `127.0.0.1:8000` even when existing environment files point elsewhere.
The explicit IPv4 addresses avoid slow IPv6 attempts through `localhost` on Windows;
database connection attempts time out after 10 seconds. It preserves
existing environment files and does not import lot models or seed sites by default.

`--demo` additionally seeds the **synthetic development site** and starts
`publish-dev-state`; it does not publish observations for Sripatum. For photo/video
observations, configure a real frame worker separately as described in the
[backend README](apps/vision-api/README.md#live-state), using
`PARKMAP_API_URL=http://127.0.0.1:8000`. Uploaded-image analysis needs no worker.

Stop app processes with Ctrl+C in their terminals. Closing the database log window
does not stop Postgres; run `docker compose stop postgres` from the repository root
to stop it while keeping its data. If startup fails after opening some terminals,
those processes stay running; stop them before retrying. To check the launcher
without starting services, use `--dry-run`. Its focused Windows tests are
`node --test tools/start-dev.test.mjs`. The two native integration cases require
free app ports and explicitly skip when development servers are already running.

## LIFF app

```sh
pnpm install --frozen-lockfile
pnpm dev:liff
```

Open <http://localhost:3001>. After changing a Pydantic API model, run `uv run python scripts/export_openapi.py` in `apps/vision-api`, then `pnpm --filter @parkmap/liff api:generate`. CI fails when either generated file is stale.

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
uv sync --locked --all-groups
uv run uvicorn app.main:app --reload --port 8000
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

Database tests skip without `PARKMAP_TEST_DATABASE_URL`, and they truncate that database. CI first decides which of `web` (calibration UI and skills), `liff`, and `api` changed, and runs only their jobs; the Python job runs against a Postgres 17 service. Changes to `.github/workflows/` or the workspace toolchain count as changes to every service. JavaScript versions shared by future packages belong in the pnpm catalog. Python direct dependencies and development groups are declared in `apps/vision-api/pyproject.toml`; CI and local development install the committed `uv.lock` with `uv sync --locked --all-groups`. CI layout is adapted from Showcase for ParkMap's runtimes.

The detection endpoint runs the configured YOLO model and returns normalized top-left motorcycle bounding boxes. Upload analysis then applies the active parking calibration, homography, physical row dimensions, occupied/free geometry, capacity, and parking-state validation.

## Production deploy

Production runs on Coolify at <https://coolify.parkmap.dev>, project `ParkMap`, environment `production`, on one VPS. Only the LIFF app is public:

| Coolify resource | Image | Role |
| --- | --- | --- |
| `parkmap-postgres` | `postgres:17` | Live state store; no public port. |
| `parkmap-api` | `ghcr.io/parkmap-team/parkmap-api` | `PARKMAP_PROCESS=api`. Runs `alembic upgrade head`, then uvicorn on port 8000. No domain; other resources reach it at `http://parkmap-api:8000` through its network alias, because Coolify names application containers `<uuid>-<timestamp>`. |
| `parkmap-worker` | `ghcr.io/parkmap-team/parkmap-api` | `PARKMAP_PROCESS=worker`. Loops the Sripatum photos as a still-image loop and publishes through the API ([ADR 0011](docs/adr/0011-still-image-loop-demo-on-estimated-calibration.md)). Photos, weights, and calibration files come from the server directory `/srv/parkmap-demo`; see the [runbook](docs/still-image-loop-runbook.md). |
| `parkmap-liff` | `ghcr.io/parkmap-team/parkmap-liff` | <https://app.parkmap.dev>, port 3001. Calls the API server-side through `PARKMAP_API_URL`. |

`DATABASE_URL`, `PARKMAP_WORKER_TOKEN`, and `PARKMAP_API_URL` are Coolify environment variables and exist nowhere else. The API has one scheduled task, `purge-states` (daily, 30-day retention). Production lists only real sites: `seed-dev` and `publish-dev-state` are for local development and never run there. `NEXT_PUBLIC_LIFF_ID` is inlined into the LIFF bundle at build time from the repository variable `PRODUCTION_LIFF_ID`, so changing it needs a new image, not a Coolify restart.

**Pipeline.** Pull requests build both images without pushing them. A push to `main` pushes `sha-<commit>` images of the changed services to GHCR, then [`.github/workflows/deploy-coolify.yml`](.github/workflows/deploy-coolify.yml) pins that tag on each Coolify application, triggers the deployment, and waits for it: the API first (it runs migrations), then the worker, and the LIFF app once the API deploy succeeded or was not needed. The workflows read repository variables `COOLIFY_URL`, `COOLIFY_APP_API`, `COOLIFY_APP_WORKER`, `COOLIFY_APP_LIFF` (application UUIDs), and `PRODUCTION_LIFF_ID`, and the secret `COOLIFY_TOKEN`, a Coolify API token with the `read`, `write`, and `deploy` abilities. The private repository's plan has no protected environments, so these are repository-level and readable by every workflow in the repository.

**Pulling private images.** The VPS is logged in to `ghcr.io` as root (`docker login ghcr.io`) with a classic personal access token that has only `read:packages`; Coolify 4.3.23 has no API for registry credentials. When that token expires, deploys fail while pulling; create a new token and log in again.

**Rollback.** Re-run the deploy jobs of an earlier successful `main` CI run; they pin that run's image tag again. Equivalently, set the image tag of the application in Coolify to an earlier `sha-<commit>` and redeploy. Rolling back the API image does not downgrade the database schema.

**Network.** Only ports 22, 80, and 443 are reachable from the internet. Coolify's direct ports (8000 for the dashboard, 6001 and 6002 for realtime and the terminal) are dropped in the `DOCKER-USER` iptables chain by `coolify-port-lockdown.service` on the VPS, because Docker-published ports bypass `ufw`. The dashboard and its realtime traffic go through the proxy at `coolify.parkmap.dev`.

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
