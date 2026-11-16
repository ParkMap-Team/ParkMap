# Shared Sripatum setup data

Migration `0004_sripatum_setup` captures the operator's active local setup on
2026-11-13: site `sripatum`, area `sripatum-near-lot`, camera `SPU_CAM_01`, the lot
geometry from local version 9, ROI and registered calibration. The checksummed
snapshot is `apps/vision-api/migrations/data/0004_sripatum_setup.json`.
The operator explicitly requested sharing this numerical setup. No credentials,
photographs, weights, drafts, dev-site, old lot versions or parking-state history
are included. Other private calibration configurations remain local.

## On a teammate's machine

From the repository root, with Postgres running and `apps/vision-api/.env` configured:

```powershell
node tools/sync-local.mjs
```

It installs locked dependencies, runs `alembic upgrade head`, restores the shared
calibration files into `apps/vision-api/config` without overwriting, downloads the
pinned `yolo11m-seg.pt`, then runs `python -m app.manage verify-setup`. The database
is `DATABASE_URL` from the environment, else from `.env`; the script refuses any host
other than `localhost`, `127.0.0.1` or `[::1]`. `--dry-run` prints the plan only.
If `config` already holds different calibration files, the restore stops: move them
to a backup and rerun. Then start the API/worker and refresh LIFF.

A fresh database uses lot version 1 with the same geometry as source version 9;
database-local version numbers are not copied as identities. Supply authorized
reference-angle images separately. A different camera viewpoint requires its own
calibration.

## Verifying an environment

`python -m app.manage verify-setup [--config-dir DIR]` is read-only. It checks that
the schema is at head; site `sripatum`, its parking areas and camera match the
snapshot; the active lot model and calibration equal the snapshot; the files in
`config` (or `DIR`) have the snapshot's calibration fingerprint, which the worker
publishes; and the segmentation weights (`PARKMAP_SEGMENTATION_MODEL_PATH`) have
SHA256 `eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf`. It lists
every difference and exits 1, or exits 0 when the environment matches this version.

## On production

Deploying `main` runs `alembic upgrade head` on API start. Then, in the `parkmap-api`
container, run `python -m app.manage verify-setup`. Production already had `sripatum`
before 0004, so the migration preserved its data; any reported difference is aligned
only by an explicit operator step from the
[still-image loop runbook](still-image-loop-runbook.md): replace `/srv/parkmap-demo/config`
with the snapshot's `config_files` texts byte for byte, `register-calibration`, then
`set-lot-model` with the snapshot's `lot_model` saved as a file, and restart the worker.
Back up what is replaced first. Nothing is overwritten automatically. Production keeps
`PARKMAP_STATE_FRESHNESS_S=60`, which also sets how long analysed photos are kept.

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
