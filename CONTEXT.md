# ParkMap context

ParkMap is a fourth-year project at Sripatum University. Motorcycles are parked in an open area without fixed marked stalls. Riders may enter expecting space deeper inside, fail to see that it is full, and leave a motorcycle blocking the exit. ParkMap should show current usable space before entry and reduce obstruction.

## Domain language

- **Site**: a place that operates ParkMap, such as the Sripatum campus or a shopping mall. It has a geographic location and one or more parking areas.
- **Parking area**: surveyed physical ground region observed by exactly one fixed camera. A larger lot is covered by adding cameras for further non-overlapping parking areas, not by fusing overlapping views.
- **Camera view**: timestamped observation from a known camera. An image alone is not a surveyed map.
- **Parking ROI**: image region considered for analysis.
- **Virtual row**: operator-defined analysis region with an internal ID. It is not a painted or numbered stall.
- **Occupied footprint**: estimated ground area taken by a detected motorcycle, with calibration and uncertainty.
- **Candidate space**: ground region where a motorcycle footprint might fit. Candidates are not reserved stalls.
- **Available**: current evidence supports fitting without obstruction.
- **Almost available**: fitting may be possible after moving another motorcycle; advisory only.
- **Unknown**: stale, occluded, uncalibrated, or low-confidence evidence. Never show as green.
- **Unmonitored**: part of the lot model outside every parking area. It is permanent, carries no availability claim, and is shown differently from unknown.
- **Lot model**: static 3D representation of a site's parking lot, including parking areas and unmonitored ground, built from surveyed measurements. It changes only when the site is re-surveyed, never from live frames.
- **Motorcycle proxy**: generic 3D motorcycle shown on the lot model at an occupied footprint's position, long-axis heading, and estimated size. It represents a detection, not a reconstruction of the actual vehicle; the MVP does not resolve front versus rear because a single camera view cannot establish that direction reliably. Regions without current evidence show as unknown, not as empty ground.
- **Proxy alignment tolerance**: the MVP accepts a Motorcycle Proxy ground-position error of at most 0.5 metres against a known reference position; this is an evaluation criterion, not a claim that every live estimate has that accuracy.
- **Proxy size tolerance**: the MVP evaluates proxy length and width against a reference with an allowed relative error of at most ±30%; this keeps a generic detection proxy from being treated as a measured reconstruction.
- **Proxy heading tolerance**: the MVP evaluates the undirected long-axis angle within 15 degrees of a reference; headings separated by 180 degrees are equivalent because front versus rear is not resolved.
- **Proxy reference set**: proxy evaluation uses the existing recorded demo line with manually annotated sample motorcycles containing a ground point, long axis, and reference length and width.
- **Vision API Python support**: `apps/vision-api` requires CPython `3.12`; the dependency lock, CI, local setup, and deployment instructions use Python 3.12 consistently.
- **Vision API dependency workflow**: `apps/vision-api` installs its runtime and development dependency groups with `uv sync --locked --all-groups`; CI and local development use the committed `uv.lock` rather than compiling or installing requirements files.
- **LIFF motorcycle proxy asset**: the LIFF app uses a generic motorcycle GLB bundled in the repository with a clearly documented license such as CC0 or Apache-2.0. It visualizes a detection's position, long-axis direction, and approximate size; it is not a reconstruction of the actual vehicle and is not loaded from a runtime-hosted external URL.
- **LIFF map fallback**: the LIFF app automatically falls back to a top-down 2D map when WebGL is unavailable or the 3D scene exceeds its load/performance threshold; users can switch between 2D and 3D manually after loading.
- **LIFF camera controls**: the 3D lot view starts in an overview preset and provides an entrance-view preset, bounded orbit and zoom, and a reset control; it does not expose unrestricted free-fly navigation.
- **LIFF map status colours**: 2D and 3D use the same API-status semantics: `AVAILABLE` is green, `ALMOST_AVAILABLE` is yellow, occupied evidence is red, `UNKNOWN` is a distinct non-availability colour, and `UNMONITORED` is a separate dark treatment. A legend explains the mapping.
- **LIFF 3D fallback threshold**: when WebGL is unavailable the LIFF app uses 2D immediately; when the 3D scene does not finish loading within 5 seconds it falls back to 2D, with manual switching retained when both renderers are available.

## Current implementation

`apps/web/` is the calibration and uploaded-image POC built with vinext/Vite. It is moving to `tools/calibration-ui/` and is not the student app.

`apps/liff/` is the student-facing LIFF app: site list, a navigable 3D view of the lot model with live regions and motorcycle proxies, and freshness and source notices.

`apps/vision-api/` is FastAPI with an Ultralytics YOLO motorcycle detector, calibration, homography, footprint fitting, capacity, almost-available, and uncertainty logic, plus the live state API and a frame worker. Model weights and site measurements must be supplied separately. See `docs/backend-parking-analysis-contract.md` and `docs/adr/0002-live-state-pipeline-and-liff-app.md`.

## Target flow

1. A fixed camera observes the hidden parking area. A separate entrance view may estimate incoming motorcycle dimensions.
2. An inference worker processes frames, applies camera calibration and parking geometry, and publishes a timestamped state with confidence and evidence freshness.
3. A student opens the web app from the LINE Official Account rich menu via LIFF and sees a surveyed map with green candidate regions, yellow advisory regions, and unknown regions.
4. Deferred beyond the first release: a dimension estimate from the entrance view may rank compatible candidate regions. Brand recognition alone cannot establish physical dimensions, and matching an entrance observation to the student viewing LIFF is unresolved. Until then, candidates are ranked for a standard motorcycle footprint.

## Recommended deployable processes

Three processes: the LIFF app, the FastAPI API with Postgres, and a Python worker on the camera network that analyzes the newest frame and pushes derived state to the API. Monitor camera freshness, inference lag, and unknown-state rate. Use a separate bot process only when webhook or chat interactions become product requirements.

The 3D map is a static surveyed lot model with detections drawn as motorcycle proxies. A single camera video does not establish hidden geometry or arbitrary viewpoints; validate the lot model against surveyed reference points before claiming it represents the real lot.

## Boundaries and safety

- The Python service owns detection, calibration, occupancy, and recommendation calculations. The web app renders results and owns LIFF integration.
- A LINE rich-menu URL can open LIFF without a bot server. Add a webhook service only when message/postback behavior is required; it need not be NestJS solely for a link.
- Do not expose raw camera credentials, raw private footage, LINE access tokens, or identifiable user data to the browser. Decide retention and access before recording footage.
- Do not label a candidate green when observation is stale, occluded, uncalibrated, or uncertain. Yellow means movement may be required, never a guaranteed instruction to move another person's vehicle.
- Current JSON calibration files and synchronous inference are development facilities. Multi-camera production needs durable state, a separate worker, explicit freshness limits, and health/lag monitoring before scale claims.

## Open product inputs

Surveyed dimensions and reference points, camera count/placement, an on-campus machine on the camera network to run the worker, acceptable update delay, acceptable false-green rate, access policy for footage, and whether students need LINE messages in addition to opening LIFF. These are required for the live system, not for the workspace setup.
