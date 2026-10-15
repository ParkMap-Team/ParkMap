# 0011: Still-image loop demo on estimated calibration

Status: accepted, 2026-10-15. Spec: #59. Terms **Still-image loop** and **Estimated calibration** are defined in `CONTEXT.md`.

## Decision

Until the demo video exists, the worker loops the team's real-angle photos of the Sripatum parking area through the real pipeline (worker, internal state API, Postgres, LIFF app), on a calibration estimated from the photos.

- **Source.** The worker accepts a directory of photos from one fixed camera viewpoint. It analyses them in file-name order, holds each for `--hold-s` seconds (default 10), re-runs detection every analysis interval during the hold, and restarts the loop after the last photo. Photos and video share one worker path. An empty directory, an unreadable photo, or a photo whose dimensions differ from the calibration reference image stops the worker with a clear error.
- **Times.** `captured_at` is the photo's real observation time, parsed from its `YYYYMMDD_HHMM` file name in Asia/Bangkok time; a file name that does not match stops the worker. `processed_at` records when the worker analysed it.
- **Source kind and status.** States publish as `STILL_IMAGE_LOOP`, never `LIVE_CAMERA` or `RECORDED_REPLAY`. A healthy loop is `DEMO`, not `LIVE`; freshness is judged on `processed_at`. When processing becomes stale, candidate regions become `UNKNOWN` and never remain `AVAILABLE` or `ALMOST_AVAILABLE`. The LIFF app permanently identifies the state as recorded demo data rather than the current parking state.
- **Estimated calibration.** Each control point and row dimension carries its own provenance (`MEASURED` or `ESTIMATED`), numeric uncertainty in metres, and estimation basis. A calibration with any estimated input is `ESTIMATED` as a whole, and every published state records the calibration's provenance. Homography and row geometry accept `ESTIMATED` inputs. A `LIVE_CAMERA` may publish diagnostics with an estimated calibration, but the API forces every parking region to `UNKNOWN` until all required geometry inputs are `MEASURED`. No distance or accuracy figure comes from an estimated calibration.
- **Reference photo and geometry.** One minimally occluded photo is the calibration reference. Another photo may share its calibration only when its resolution and viewpoint match. Demo geometry is limited to the Parking ROI supported by the reference photo; surrounding ground is `UNMONITORED`.
- **Motorcycle size.** In a still-image loop, every Motorcycle Proxy and fitting calculation uses one documented standard motorcycle footprint. The LIFF app does not present per-motorcycle dimensions.
- **Deployment.** A `parkmap-worker` process on Coolify runs from the API image. Photos, weights, and calibration files reach it on a Coolify volume copied by hand from the team Drive, never through Git or the image. The API container reads the same calibration files read-only, so `register-calibration` and the worker agree on the calibration version.
- **Production holds only real sites.** While the demo runs, production behaves as the product would: the synthetic dev publisher is not deployed and the fake development site is not listed. The development site stays available for local development.
- **Photos leave Git.** The seven real-angle photos are removed from the working tree and kept in the team Drive. Git history is not rewritten.

## Why

The team has no demo video yet, only seven real-angle photos, no on-site measurements, and no real lot model. Looping the photos exercises the whole product path now, and the same worker path takes the video later (#29). Marking the source, status, and calibration provenance on every state keeps a demo on guessed geometry from being mistaken for a live, measured result (0004). Using the photos' real observation time and a `DEMO` status keeps the LIFF app honest that the data is from 25 September.

## Considered options

- **No source notice for the loop**: rejected; viewers could not tell the data is from repeated photos, and the presenter would carry that burden alone.
- **Report the loop as `LIVE` with `captured_at` set to now**: rejected; it would claim a current observation that does not exist.
- **Accept `ESTIMATED` geometry for live cameras with only `AVAILABLE` and `ALMOST_AVAILABLE` suppressed**: rejected in favour of forcing every parking region to `UNKNOWN`, so no live answer rests on guessed geometry.
- **A draft lot model covering surrounding ground**: rejected; an estimated scale makes any ground outside the ROI a guess.
- **Purging the photos from Git history**: rejected; removing them from the tree is enough, and a force-push would make every clone re-clone.

## Consequences

- The state contract gains `STILL_IMAGE_LOOP`, `DEMO`, `processed_at`, and the calibration provenance; the OpenAPI document and LIFF types are regenerated.
- Distances and accuracy figures stay unavailable until #17 replaces the estimated inputs with measured ones.
- Earlier commits still contain the photos; anyone with repository access can read them from history.
- #29 later swaps the photo source for the video replay on the same worker service.
