# ParkMap context

ParkMap is a fourth-year project at Sripatum University. Motorcycles are parked in an open area without fixed marked stalls. Riders may enter expecting space deeper inside, fail to see that it is full, and leave a motorcycle blocking the exit. ParkMap should show current usable space before entry and reduce obstruction.

## Domain language

- **Site**: a place that operates ParkMap, such as the Sripatum campus or a shopping mall. It has a geographic location and one or more parking areas.
- **Parking area**: surveyed physical ground region observed by exactly one fixed camera. A larger lot is covered by adding cameras for further non-overlapping parking areas, not by fusing overlapping views.
- **Camera view**: timestamped observation from a known camera. An image alone is not a surveyed map.
- **Parking ROI**: image region considered for analysis.
- **Parking ROI miss**: an annotated motorcycle whose ground point (wheel-ground contact nearest the camera) is inside the calibrated Parking ROI but which no detection matches. It is the detector's conservative safety measure; see `docs/detector-evaluation-protocol.md`.
- **Virtual row**: operator-defined analysis region with an internal ID. It is not a painted or numbered stall.
- **Occupied footprint**: estimated ground area taken by a detected motorcycle, with calibration and uncertainty.
- **Candidate space**: ground region where a motorcycle footprint might fit. Candidates are not reserved stalls.
- **Available**: current evidence supports fitting without obstruction.
- **Almost available**: fitting may be possible after moving another motorcycle; advisory only.
- **Unknown**: stale, occluded, uncalibrated, or low-confidence evidence. Never show as green.
- **Unmonitored**: part of the lot model outside every parking area. It is permanent, carries no availability claim, and is shown differently from unknown.
- **Lot model**: static 3D representation of a site's parking lot, including parking areas and unmonitored ground, built from surveyed measurements. It changes only when the site is re-surveyed, never from live frames.
- **Stand-in data**: public dataset images, simulated scenes, or AI-generated video used while real-angle footage is unavailable. It supports development and demos, never accuracy claims about the real lot (ADR 0004).
- **Simulated scene**: video not recorded in a real lot. Rendered from the lot model it has exact ground truth for testing geometry and fitting; produced by a generative video model it has no ground truth and may drift in geometry. Its replays publish as `SIMULATED_REPLAY`, never as `RECORDED_REPLAY`.
- **Motorcycle proxy**: generic 3D motorcycle shown on the lot model at an occupied footprint's position, long-axis heading, and estimated size. It represents a detection, not a reconstruction of the actual vehicle; the MVP does not resolve front versus rear because a single camera view cannot establish that direction reliably. A future directed-heading experiment may attempt that distinction, but it must not replace the axis-only behavior until validated against a locked reference set. Regions without current evidence show as unknown, not as empty ground.
- **Proxy alignment tolerance**: the initial demo accepts a Motorcycle Proxy ground-position error of at most 0.5 metres against a known reference position; this may be revised after evaluating the locked reference set and is not evidence that a candidate space is `AVAILABLE`.
- **Proxy size tolerance**: the initial demo evaluates proxy length and width against a reference with an allowed relative error of at most ±30%; this keeps a generic detection proxy from being treated as a measured reconstruction and is not a production accuracy target.
- **Proxy heading tolerance**: the initial demo evaluates the undirected long-axis angle within 15 degrees of a reference; headings separated by 180 degrees are equivalent because front versus rear is not currently resolved.
- **Proxy reference set**: proxy evaluation uses the existing recorded demo line with manually annotated sample motorcycles containing a ground point, long axis, and reference length and width.
- **Vision API Python support**: `apps/vision-api` requires CPython `3.12`; the dependency lock, CI, local setup, and deployment instructions use Python 3.12 consistently.
- **Vision API dependency workflow**: `apps/vision-api` installs its runtime and development dependency groups with `uv sync --locked --all-groups`; CI and local development use the committed `uv.lock` rather than compiling or installing requirements files.
- **LIFF motorcycle proxy asset**: the LIFF app uses a generic motorcycle GLB 3D model bundled in the repository with a clearly documented license such as CC0 or Apache-2.0. It visualizes a detection's position, long-axis direction, and approximate size; it is not a reconstruction of the actual vehicle and is not loaded from a runtime-hosted external URL.
- **LIFF camera controls**: the 3D lot view starts in an elevated overview preset that frames the whole lot. It provides zoom, a reset control that returns to the overview, and an optional free-fly mode for arbitrary navigation through the static lot model; it does not provide an entrance-view preset or orbit controls. Changing the virtual viewpoint never creates new observation evidence or changes `UNKNOWN` or `UNMONITORED` ground into available space.
- **LIFF map status colours**: 2D and 3D use the same API-status semantics: `AVAILABLE` is green, `ALMOST_AVAILABLE` is yellow, occupied evidence is red, `UNKNOWN` is a distinct non-availability colour, and `UNMONITORED` is a separate dark treatment. A legend explains the mapping.
- **LIFF map fallback**: the LIFF app falls back to a top-down 2D map immediately when WebGL is unavailable, or when the 3D scene does not finish loading within 10 seconds; there is no runtime frame-rate trigger. Users can switch between 2D and 3D manually when both renderers are available.
- **Near-me site list**: the LIFF `/nearby` page, opened from the rich menu, lists sites and offers a "use my location" action that sorts them by distance and shows each distance. The final has one real site, so sorting is proven with two seeded sites in tests; a second real site stays out of scope. The browser asks for location only when the user taps that action, computes distances on the device, and keeps the position in page memory only: it is never sent to the API, a Next route handler, logs, or analytics, and never stored in browser storage, so each visit asks again. The list renders by name without waiting for location, so a single site stays one tap away; if permission is denied, geolocation is unsupported, or no position arrives within 10 seconds, the list stays as it is with a short message and no sorting.
- **Entrance camera**: fixed camera at a site's entrance that reads the licence plates of entering motorcycles. It observes no parking area and makes no availability claim.
- **Registered plate**: a licence plate, identified by its characters and number together with its province, that a student binds to their LINE account; one plate per account and one account per plate, and the first registration wins. Ownership is not verified, so a plate can be claimed by someone who is not its owner.
- **Plate match**: an entrance-camera read matches a registered plate only on a confident read of the characters and number; it also needs the province when that is read confidently, and otherwise exactly one registered plate with those characters and number. Low-confidence reads are discarded, never matched approximately.
- **Plate handoff**: matching a plate read by the entrance camera to the single new motorcycle track that appears on the entrance side of a parking area's view within the handoff window. More than one candidate track makes the handoff ambiguous.
- **Parking record**: where and when a registered plate's motorcycle stopped on the lot model. It exists only when the plate handoff is unambiguous, one continuous track runs from handoff to stop with no sign of a switch to another motorcycle, and the motorcycle stays stationary for the stationary period; otherwise there is no parking record, only a coarse reason (track lost, ambiguous handoff, not parked in a parking area). It states where the motorcycle stopped, never that it is still there. Track-gap, overlap, and stationary thresholds are tuned on the demo video.
  _Avoid_: stall, spot number, "your motorcycle is here"
- **Synchronized replay**: an entrance video and a parking-area video replayed on one clock, aligned by a video offset set from an event visible in both, such as a clap or a flash. Plate handoff is only defined within a synchronized replay or between live cameras on one clock.
- **Wrong-record rate**: the share of parking records whose position belongs to a motorcycle other than the registered plate's, measured against team-labelled ground truth. The target is zero; coverage, the share of entries that get a parking record, is reported alongside it.
- **Entrance sighting**: the latest time the entrance camera produced a plate match for a registered plate. It is shown when there is no parking record, so the student knows the motorcycle entered even though its stop was not recorded.

## Current implementation

`tools/calibration-ui/` is the calibration and uploaded-image POC built with vinext/Vite. It is not the student app, and it is the repository's only calibration tool.

`apps/liff/` is the student-facing LIFF app: site list, a navigable 3D view of the lot model with live regions and motorcycle proxies, and freshness and source notices.

`apps/vision-api/` is FastAPI with an Ultralytics YOLO motorcycle detector, calibration, homography, footprint fitting, capacity, almost-available, and uncertainty logic, plus the live state API and a frame worker. Model weights and site measurements must be supplied separately. See `docs/backend-parking-analysis-contract.md` and `docs/adr/0002-live-state-pipeline-and-liff-app.md`.

## Target flow

1. A recorded video from one fixed viewpoint stands in for the camera on the hidden parking area; the final deliverable is this replay, not an installed camera (ADR 0005). A separate entrance view may estimate incoming motorcycle dimensions.
2. An inference worker processes frames, applies camera calibration and parking geometry, and publishes a timestamped state with confidence and evidence freshness.
3. A student opens the web app from the LINE Official Account rich menu via LIFF and sees a surveyed map with green candidate regions, yellow advisory regions, and unknown regions. In the demo the video plays separately on the presenter's screen and the LIFF app shows the video time of the analysed frame, never the footage (ADR 0005).
4. Deferred beyond the first release: a dimension estimate from the entrance view may rank compatible candidate regions. Brand recognition alone cannot establish physical dimensions, and matching an entrance observation to the student viewing LIFF is unresolved. Until then, candidates are ranked for a standard motorcycle footprint.
5. Proposed for the final, pending advisor approval (ADR 0010): a student who registered a plate opens "where I parked" and sees their parking record on the lot model, or, without one, the reason and their entrance sighting. The student marks nothing.

## Recommended deployable processes

Three processes, all on Coolify (ADR 0005): the LIFF app, the FastAPI API with Postgres, and a Python worker that replays a recorded video at its real pace, analyzes the newest frame, and pushes derived state to the API. A live camera is future work and would be another source for the same worker. Monitor camera freshness, inference lag, and unknown-state rate. Use a separate bot process only when webhook or chat interactions become product requirements.

The 3D map is a static surveyed lot model with detections drawn as motorcycle proxies. A single camera video does not establish hidden geometry or arbitrary viewpoints; validate the lot model against surveyed reference points before claiming it represents the real lot.

## Boundaries and safety

- The Python service owns detection, calibration, occupancy, and recommendation calculations. The web app renders results and owns LIFF integration.
- A LINE rich-menu URL can open LIFF without a bot server. Add a webhook service only when message/postback behavior is required; it need not be NestJS solely for a link.
- Do not expose raw camera credentials, raw private footage, LINE access tokens, or identifiable user data to the browser; the one exception is a student's own registered plate, parking record, and entrance sighting, shown only to that student (ADR 0010). Recording, storage, access, blurring, training use, and deletion of real footage follow `docs/footage-policy.md`.
- Do not label a candidate green when observation is stale, occluded, uncalibrated, or uncertain. Yellow means movement may be required, never a guaranteed instruction to move another person's vehicle.
- Current JSON calibration files and synchronous inference are development facilities. Multi-camera production needs durable state, a separate worker, explicit freshness limits, and health/lag monitoring before scale claims.

## Open product inputs

The Sripatum demo video (a fixed phone recording, ADR 0005) and surveyed dimensions and reference points of its parking area, acceptable update delay, acceptable false-green rate, and whether students need LINE messages in addition to opening LIFF. These are required for the demo, not for the workspace setup.
