# Roadmap

Plan from 30 Sep 2026 to the final presentation. Tracks are areas of work, not people: every member takes issues from several tracks so everyone works across ML, platform, app, and site. GitHub milestones, `track:*` labels, and assignees mirror this file. Update this file when a date or scope changes.

## Before starting any issue

Every assignee runs `/grill-with-docs` on their issue before writing code, reads `CONTEXT.md` and `docs/adr/`, and records resolved terms in `CONTEXT.md` and hard-to-reverse decisions as a new ADR. Change the contract only through `apps/vision-api/app/models.py`, then regenerate `openapi.json` and the LIFF types in the same pull request, with review from the owners of the affected API and LIFF issues.

## Tracks

| Track | Scope | Main paths |
|---|---|---|
| A. Vision/ML | Dataset, YOLO fine-tuning, footprint and heading, evaluation, false-green rate | `apps/vision-api/app/services/`, `models/` (not in Git) |
| B. Worker/Platform | Worker replaying recorded video, ingest, database, deployment on Coolify, operations | `apps/vision-api/app/worker/`, `app/db/`, `migrations/`, `compose.yaml` |
| C. LIFF/3D | LIFF app, 3D lot model, motorcycle proxies, LINE OA and rich menu | `apps/liff/` |
| D. Site/Calibration | Demo video viewpoint, site survey, lot model JSON, calibration in the database, calibration tool | `tools/calibration-ui/`, calibration services, site data |

Starting issues: A #4 to #7, B #8 to #11, C #12 to #14, D #15 to #20. Filter by `track:*` label; new issues also get `needs-grill` until grilled.

## Assignments

| Member | A. Vision/ML | B. Worker/Platform | C. LIFF/3D | D. Site/Calibration |
|---|---|---|---|---|
| @GoodNightMare | #6 | #11 | #13 | #18 (M1), #19 |
| @SaGaGro | #4 (M1), #7 | | #14 | #16 (M1) |
| @Dawinzhii | #5 | #8 (M1), #10 | | #17 (M1) |
| @Sayhighz | | #9 | #12 (M1) | #15 (M1), #20 |

Hand-offs cross people on purpose: #16 unblocks #4 and #8, #4 feeds #5, #6 feeds #13, #20 unblocks #9, and #15 unblocks #7. Pair on the hand-off instead of waiting for it.

## Milestones

| Milestone | Due | Exit criteria |
|---|---|---|
| M0 Phase 0 foundation | 4 Oct | Contract, fixture, LIFF scaffold, worker and database skeleton, CI, ADR 0002, issues open. D has started the camera permission request. |
| M1 Progress presentation | 11 Oct (presentations 12 to 17 Oct) | End-to-end demo replaying an AI-generated video made from the real-angle photo: worker, API, Postgres, LIFF 3D. The LIFF announces it as `SIMULATED_REPLAY`. A reports a baseline on stand-in data, labelled as not real-angle accuracy (ADR 0004). D has a draft lot model and a calibration from `ESTIMATED` control points on the real-angle photo. |
| M2 Integration | 8 Nov | Worker, API, Postgres, and LIFF deployed on Coolify replaying the demo video (ADR 0005), calibration in the database, fine-tuned model, rich menu opens LIFF. |
| M3 Field test and freeze | 20 Nov | False-green rate measured on labelled frames of the demo video, feature freeze, report states the one-camera, one-view limit. |
| M4 Final presentation | 22 Nov (presentations 23 to 28 Nov) | Rehearsed demo and final report. |

## Weekly plan

**30 Sep to 4 Oct (M0).** Phase 0 lands. D submits the camera permission request for mounting and power; the camera network is team-owned (ADR 0003).

**5 to 11 Oct (toward M1).**
- A: baseline on stand-in data (public datasets, simulated scenes); real-angle footage once the lot is accessible (ADR 0004).
- B: worker replays the AI-generated M1 video against local Postgres; `publish-dev-state` keeps working.
- C: LIFF opens from a test rich menu and renders the lot model and proxies from seeded data. The LIFF app and an internal-only API with seeded data go on Coolify now (pulled forward from #9; see the production deploy section of the root README). A developer who wants to check changes inside LINE uses a dev LIFF app through their own Cloudflare Tunnel; the others develop at localhost (see `apps/liff/README.md`).
- D: draft lot model JSON and calibration from `ESTIMATED` control points (known object sizes in the real-angle photo); footage policy agreed, including cloud storage. Replace them with `MEASURED` points once someone can safely survey the lot.

**18 Oct to 8 Nov (M2).** Demo video recorded, calibration moved into the database, deployment on Coolify, fine-tuning, worker hardening, 2D fallback and near-me in LIFF.

**9 to 20 Nov (M3).** False-green measurement on the demo video, fixes only, report.

## Open decision: free-space evidence method

Today `AVAILABLE` means positive capacity with no row-assignment ambiguity; nothing checks whether the ground is visible, so a missed or hidden motorcycle can turn into green. The method is not chosen. Track A explores and evaluates before deciding, then records the choice as an ADR.

- **Candidates (at least):** YOLO box detection with footprint fitting (current baseline); YOLO instance segmentation; oriented boxes; a geometric occlusion check that marks a candidate space `UNKNOWN` when another motorcycle hides it (combinable with any detector); visible-ground segmentation or change detection against an empty-lot reference; open-vocabulary detection or segmentation such as Grounding DINO or SAM.
- **Criteria:** false-green on candidate spaces first, then Parking ROI misses, unknown rate (over-caution), footprint and heading error (#6), inference time at a 2 to 5 s cadence on Coolify, labelling format and data needed, and whether it can be tested before the lot reopens.
- **Evidence:** stand-in data only until real footage exists, reported as such (ADR 0004); rendered scenes where exact ground truth is needed.
- **Deliverable, due 18 Oct:** a note in `docs/` with each candidate's results and trade-offs and one recommended method. The spike is timeboxed; candidates that need real footage may be assessed on paper only. Large-scale labelling for #5 waits for it, because the method sets the label format.

## Critical path and risks

The critical path is outside the code: a phone recording of the Sripatum parking area once flooding allows, a survey of that area, then calibration. No camera is installed (ADR 0005).

- **Footage policy late.** Agree #16, including cloud storage, before recording or uploading real footage.
- **Lot flooded, no real-angle footage** (ADR 0004). Work continues on stand-in data, which never counts as real-lot accuracy. If the lot is still inaccessible on 26 Oct, renegotiate M3 scope with the advisor.
- **Model accuracy on the real angle.** Measure on phone footage as soon as the lot is usable; any uncertainty stays `UNKNOWN`, never green.
- **Contract drift between tracks.** CI fails on stale `openapi.json` or LIFF types.

## Out of scope for the final

Live camera installation and operation, entrance camera for motorcycle size or brand, LINE identity, push messages, a bot webhook, multi-camera fusion, and a second site. These stay recorded as future work in `CONTEXT.md`.
