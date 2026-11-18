# 0020: Share recommendation holds across Guard Booth and LINE

Accepted 2026-11-18 at the owner's request.

## Decision

The Vision API owns one PostgreSQL recommendation ledger per site. Guard Booth
classification and an explicit LINE “recommend parking” action use that ledger.
Opening the map alone does not reserve space. LINE's server verifies the session
and reads its saved model; a browser-supplied family or availability is not trusted.
Unknown models receive no size-specific placement.

The site row is locked before loading evidence, fitting against every blocking
polygon and saving the recommendation in the same transaction. The whole frame,
including fitting clearance, blocks later requests from both channels. There are
no fixed physical stalls. API processes share the database lock, including after
a restart; an in-memory lock cannot substitute for it.

A successful request keeps its UUID, channel, family, area, geometry version,
original frame, issue time, two-minute deadline, original result and transition
history. A retry never extends its deadline or silently moves its point. Reusing
a UUID with another channel, model or replay lifetime returns 409. Failed fits
reserve nothing and can be retried against a later observation with the same ID.
Browser session storage keeps only opaque request UUIDs for refresh recovery;
LINE credentials and rider images are never stored with holds.

## Lifecycle

- `HELD`: two-minute grace period while someone may be approaching. Light-blue
  held geometry is cut out of the map's green candidates by Python.
- `OCCUPIED_CONFIRMED`: a newer compatible Segment result intersects that frame.
  This confirms occupancy of the region, without identifying the entering rider.
  Current Segment occupancy is shown in red and the instruction stops.
- `AWAITING_CONFIRMATION`: deadline reached without evidence proving it empty.
  It stays blocked, including during stale, missing, occluded or mismatched data.
- `RELEASED`: after the deadline, a newer compatible current observation covers
  the entire frame with empty evidence and no actual unknown/occluded patch.
  Live observations must be captured at or after the deadline. For the existing
  still-image demo only, processing time is used instead of historical capture
  time; width-preview bands remain experimental, not measured live availability.

Segment ingestion reconciles the ledger. Hold reads and recommendation retries
also reconcile, so no background timer is required. UI polling may lag by one
poll; allocation itself always checks the database under the lock. Expiration
alone never makes a frame available. An occupied-confirmed frame remains in the
ledger until compatible empty evidence can release it. State history survives
API restarts; no cross-camera tracking or vehicle identity matching is required.

## Existing demo and boundaries

Sripatum's current Python fitter and right-to-left aisle routing remain the
supported allocation geometry. This change does not generalize route planning or
turn width-only fitting into a live full-footprint guarantee. Its existing
width-only depth cap remains unchanged.

Entrance-clip holds explicitly marked `ends_with_photo` end with that demo scene.
Only Guard Booth can use that lifetime; LINE holds never disappear merely because
the photo changes. Replayed riders use scene-specific IDs. Both kinds block each
other while active. Segment needs no knowledge of a LINE account or booth rider.

A calibration or lot-model change cannot clear old holds using new coordinates.
New allocation fails closed while any blocking hold has a different geometry
version. Resolving such holds requires an operator-reviewed process; automatic
coordinate remapping/cancellation is outside this change.

## Delivery and verification

Migration `0007_shared_parking_holds` creates the ledger in `parkmap`. Run normal
API Alembic upgrades before running the new API, then release the matching LIFF
contract. Existing configuration `PARKMAP_GUARD_BOOTH_FIT_PREVIEW=1` on the API
and LIFF enables the current Sripatum recommendation feature. No new service,
Redis dependency, model weights, LINE login bypass or camera credential is added.
As with existing operator endpoints, the Python API must remain private behind
the trusted server boundary.

Focused tests use a separate disposable PostgreSQL database and prove concurrent
cross-channel allocation, retry/restart durability, lifecycle evidence gates,
scene isolation, geometry-change gates, map subtraction and public ingestion/API
flow. Real LINE login and live-camera calibration remain deployment verification
requirements. Terminal ledger rows and their small JSON transition histories are
retained; no private footage or account identity is included.
