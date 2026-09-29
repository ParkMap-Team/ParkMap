# ParkMap context

ParkMap is a fourth-year project at Sripatum University. Motorcycles are parked in an open area without fixed marked stalls. Riders may enter expecting space deeper inside, fail to see that it is full, and leave a motorcycle blocking the exit. ParkMap should show current usable space before entry and reduce obstruction.

## Domain language

- **Parking area**: surveyed physical ground region visible to a fixed camera.
- **Camera view**: timestamped observation from a known camera. An image alone is not a surveyed map.
- **Parking ROI**: image region considered for analysis.
- **Virtual row**: operator-defined analysis region with an internal ID. It is not a painted or numbered stall.
- **Occupied footprint**: estimated ground area taken by a detected motorcycle, with calibration and uncertainty.
- **Candidate space**: ground region where a motorcycle footprint might fit. Candidates are not reserved stalls.
- **Available**: current evidence supports fitting without obstruction.
- **Almost available**: fitting may be possible after moving another motorcycle; advisory only.
- **Unknown**: stale, occluded, uncalibrated, or low-confidence evidence. Never show as green.

## Current implementation

`apps/web/` is a React App Router dashboard built with vinext/Vite and Cloudflare tooling. It supports uploaded-image analysis, calibration, and a measured 2D parking map. It is not yet a LIFF app, live camera viewer, or freely navigable 3D scene.

`apps/vision-api/` is FastAPI with an Ultralytics YOLO motorcycle detector, upload endpoint, calibration, homography, footprint fitting, capacity, almost-available, and uncertainty logic. Uploaded-image inference returns a request response while inference runs in a worker thread. Model weights and site measurements must be supplied separately. See `docs/backend-parking-analysis-contract.md`.

## Target flow

1. A fixed camera observes the hidden parking area. A separate entrance view may estimate incoming motorcycle dimensions.
2. An inference worker processes frames, applies camera calibration and parking geometry, and publishes a timestamped state with confidence and evidence freshness.
3. A student opens the web app from the LINE Official Account rich menu via LIFF and sees a surveyed map with green candidate regions, yellow advisory regions, and unknown regions.
4. A dimension estimate from the entrance view may rank compatible candidate regions. Brand recognition alone cannot establish physical dimensions.

## Recommended deployable processes

For the current upload POC, run `apps/web` and `apps/vision-api`. When fixed cameras are connected, use three independently deployed processes: web/LIFF, FastAPI read/config API, and a Python vision worker that ingests frames and runs inference. The worker and API should share Python domain code, not call each other for every frame. A durable store holds the latest timestamped state; a bounded job queue isolates frame processing and allows dropping superseded frames. Monitor camera freshness, inference lag, and unknown-state rate. Use a separate bot process only when webhook or chat interactions become product requirements.

The map can be a navigable 3D representation only after a ground model and camera-to-ground alignment exist. A single camera video does not establish hidden geometry or arbitrary viewpoints. Start from measured geometry and the existing 2D map; validate a 3D scene against surveyed reference points before claiming it represents the real lot.

## Boundaries and safety

- The Python service owns detection, calibration, occupancy, and recommendation calculations. The web app renders results and owns LIFF integration.
- A LINE rich-menu URL can open LIFF without a bot server. Add a webhook service only when message/postback behavior is required; it need not be NestJS solely for a link.
- Do not expose raw camera credentials, raw private footage, LINE access tokens, or identifiable user data to the browser. Decide retention and access before recording footage.
- Do not label a candidate green when observation is stale, occluded, uncalibrated, or uncertain. Yellow means movement may be required, never a guaranteed instruction to move another person's vehicle.
- Current JSON calibration files and synchronous inference are development facilities. Multi-camera production needs durable state, a separate worker, explicit freshness limits, and health/lag monitoring before scale claims.

## Open product inputs

Surveyed dimensions and reference points, camera count/placement, acceptable update delay, acceptable false-green rate, access policy for footage, and whether students need LINE messages in addition to opening LIFF. These are required for the live system, not for the workspace setup.
