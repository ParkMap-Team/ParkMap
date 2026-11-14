# Show the analysed photo in LIFF

Accepted 2026-11-15. Supersedes the rule that raw frames and footage never reach the browser in
[0002](0002-live-state-pipeline-and-liff-app.md) and [0005](0005-cloud-hosted-video-replay-demo.md),
and the rule in [0011](0011-still-image-loop-demo-on-estimated-calibration.md) that LIFF permanently
labels `DEMO` as recorded demo data and shows the photo time.

The final presentation should read as a finished product: a rider opens an area and sees the photo
the state was derived from, without demo, experiment or recorded-data wording. The worker therefore
uploads each analysed frame, downscaled JPEG, to `PUT /api/internal/parking-areas/{id}/frame` with
the worker token before it publishes the state. A fresh `LIVE` or `DEMO` area state carries `frame`
(URL and size) only when a stored frame has the same `processed_at`, so the photo is never one the
regions were not computed from. The photo URL is versioned by `processed_at` and immutable. A reader
can hold a state a poll or more behind the newest analysis, so the API keeps each area's frames
processed within the freshness limit before its newest one: any state that can still be shown fresh
can load its own photo, and older frames are deleted. A frame upload failure never blocks the state.

The backend contract is unchanged: `DEMO`, `STILL_IMAGE_LOOP`, freshness, calibration and uncertainty
keep their semantics, and every green decision stays on the server. LIFF now presents `DEMO` exactly
as `LIVE` and drops the source badge, photo time, recorded-data notice and experimental wording.

Rejected: a privacy-processed photo (blurred plates and people), at the operator's request.
Accepted cost: the photo is served raw to every LIFF reader, exposing plates and people, so footage
must be allowed by the #16 policy for public display; and a still-image loop's recorded photo is
presented as the current lot without saying so, so readers may take recorded occupancy as live.
