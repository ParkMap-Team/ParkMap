# Roadmap

Plan from 30 Sep 2026 to the final presentation. Names are filled in later; tracks are assigned as Person A to D. GitHub milestones and `track:*` labels mirror this file. Update this file when a date or scope changes.

## Before starting any issue

Every assignee runs `/grill-with-docs` on their issue before writing code, reads `CONTEXT.md` and `docs/adr/`, and records resolved terms in `CONTEXT.md` and hard-to-reverse decisions as a new ADR. Change the contract only through `apps/vision-api/app/models.py`, then regenerate `openapi.json` and the LIFF types in the same pull request, with review from Track B and Track C.

## Tracks

| Track | Owner | Scope | Main paths |
|---|---|---|---|
| A. Vision/ML | Person A | Dataset, YOLO fine-tuning, footprint and heading, evaluation, false-green rate | `apps/vision-api/app/services/`, `models/` (not in Git) |
| B. Worker/Platform | Person B | Worker on recorded video and RTSP, ingest, database, deployment on Coolify, operations | `apps/vision-api/app/worker/`, `app/db/`, `migrations/`, `compose.yaml` |
| C. LIFF/3D | Person C | LIFF app, 3D lot model, motorcycle proxies, LINE OA and rich menu | `apps/liff/` |
| D. Site/Calibration | Person D | Camera permission and installation, site survey, lot model JSON, calibration in the database, calibration tool | `tools/calibration-ui/`, calibration services, site data |

Starting issues: A #4 to #7, B #8 to #11, C #12 to #14, D #15 to #20. Filter by `track:*` label; new issues also get `needs-grill` until grilled.

## Milestones

| Milestone | Due | Exit criteria |
|---|---|---|
| M0 Phase 0 foundation | 4 Oct | Contract, fixture, LIFF scaffold, worker and database skeleton, CI, ADR 0002, issues open. D has started the camera permission request. |
| M1 Progress presentation | 11 Oct (presentations 12 to 17 Oct) | End-to-end demo from a recorded video: worker, API, Postgres, LIFF 3D. The LIFF shows it as recorded. A reports baseline precision and recall on phone footage from the real angle. D has a first survey and a draft lot model. |
| M2 Integration | 8 Nov | Real camera or the phone fallback, calibration in the database, API and LIFF deployed on Coolify, fine-tuned model, rich menu opens LIFF. |
| M3 Field test and freeze | 20 Nov | False-green rate measured in the real lot, feature freeze, report states the one-camera, one-view limit. |
| M4 Final presentation | 22 Nov (presentations 23 to 28 Nov) | Rehearsed demo and final report. |

## Weekly plan

**30 Sep to 4 Oct (M0).** Phase 0 lands. D submits the camera permission request and asks for an on-campus machine on the camera network.

**5 to 11 Oct (toward M1).**
- A: phone footage from the planned camera angle, labelled baseline, precision and recall.
- B: worker runs on a recorded video against local Postgres; `publish-dev-state` keeps working.
- C: LIFF opens from a test rich menu and renders the lot model and proxies from seeded data.
- D: first site survey, draft lot model JSON, footage policy agreed.

**18 Oct to 8 Nov (M2).** Camera installed, calibration moved into the database, deployment on Coolify, fine-tuning, worker hardening, 2D fallback and near-me in LIFF.

**9 to 20 Nov (M3).** Field test, false-green measurement, fixes only, report.

## Critical path and risks

The critical path is outside the code: permission, then camera installation, then site survey, then calibration. Track D starts the paperwork on day one.

- **Camera not installed by about 26 Oct.** Fall back to a phone fixed at the planned camera angle and record video for replay. Agree the footage policy before recording.
- **No on-campus machine.** The worker needs camera-network access; a laptop on the same network is the fallback for demos.
- **Model accuracy on the real angle.** Measure early on phone footage; any uncertainty stays `UNKNOWN`, never green.
- **Contract drift between tracks.** CI fails on stale `openapi.json` or LIFF types.

## Out of scope for the final

Entrance camera for motorcycle size or brand, LINE identity, push messages, a bot webhook, multi-camera fusion, and a second site. These stay recorded as future work in `CONTEXT.md`.
