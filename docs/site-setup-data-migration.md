# Shared Sripatum setup data

Migration `0004_sripatum_setup` captures the operator's active local setup on
2026-11-13: site `sripatum`, area `sripatum-near-lot`, camera `SPU_CAM_01`, the lot
geometry from local version 9, ROI and registered calibration. The checksummed
snapshot is `apps/vision-api/migrations/data/0004_sripatum_setup.json`.
The operator explicitly requested sharing this numerical setup. No credentials,
photographs, weights, drafts, dev-site, old lot versions or parking-state history
are included. Other private calibration configurations remain local.

## On a teammate's machine

Use code including PR #82's uniform display-scale support. The snapshot's map
ROI is display-scaled; physical calibration and gap dimensions are unchanged.
From `apps/vision-api`, with Postgres running and their own `.env` configured:

```powershell
uv run --no-sync python -m alembic upgrade head
uv run --no-sync python -m app.manage restore-seed-calibration --parking-area-id sripatum-near-lot --output-dir config
```

Start the API/worker and refresh LIFF. A fresh database uses lot version 1 with
the same geometry as source version 9; database-local version numbers are not
copied as identities. Supply authorized reference-angle images and model weights
separately. A different camera viewpoint requires its own calibration.

The migration inserts setup only when the site is absent. Existing `sripatum`
data is preserved, including camera identity, active layout, draft and calibration.
An area/camera ID already assigned elsewhere also prevents insertion; logs explain
the skip. It never silently changes an existing deployment to `SPU_CAM_01`.
Replacing an existing site's settings remains a separate explicit import/review
operation, not an automatic migration side effect.

## Calibration bytes and rollback

The three original calibration file texts are included because the worker hashes
file bytes, not just parsed JSON values. The restore command verifies registered
version, payload and camera identity, then restores exact UTF-8 bytes. It is
idempotent and refuses to overwrite differing files. Back up existing files and
choose an empty output directory if they differ; do not reformat the JSON files.

`upgrade head` does not write config files or publish availability. Worker
observations are generated afresh. Downgrading this data-only revision retains
setup data, since an operator may have edited it or added observations. Re-upgrade
preserves that site. Removing a site stays an explicit operator command.

Tests cover fresh databases, repeat upgrades, existing-site/camera preservation,
down/up round trips, calibration fingerprints and overwrite rejection.
