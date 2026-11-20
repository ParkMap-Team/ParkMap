# Still-image loop runbook

How production runs the Sripatum still-image loop demo ([ADR 0011](adr/0011-still-image-loop-demo-on-estimated-calibration.md)). The photos, detector weights, and calibration files are private: they move from the team Drive to the server by hand and never enter Git, an image, a ticket, or a log.

## Production alignment on 2026-11-20

The owner authorized aligning production with `feat/liff-motorcycle-settings`,
whose code is also on `main` at
`d42d251f9e3b6318fb8d8a9cc39e01c1e4a4a888`. These settings supersede the older
model and photo settings below:

- The API builds `apps/vision-api/Dockerfile`, target `default`, from that pinned
  commit. The worker uses `Dockerfile.ghcr` with the server-local API image
  `PARKMAP_IMAGE=qcd6g1zexf0ltlsqpb5mcudy:d42d251f9e3b6318fb8d8a9cc39e01c1e4a4a888`.
  Both processes therefore run the same code. For another release, build the API
  first, then update the worker's `PARKMAP_IMAGE` to that new API image before
  deploying the worker. Changing `docker_registry_image_tag` alone does not
  change the base image used by `Dockerfile.ghcr`.
- API and worker use `PARKMAP_SEGMENTATION_MODEL_PATH=/app/models/yolo26n-seg_round-08_best.pt`,
  `PARKMAP_SEGMENTATION_CLASS_ID=0`, `PARKMAP_SEGMENTATION_IMGSZ=960`, and
  `PARKMAP_MODEL_CONF=0.1`. The checkpoint SHA256 is
  `9f835c67849593cafc423414161d44b8377deaf221348b4929213544715ca1af`.
  The branch's confidence is lower than the service default of `0.25`; it must
  be set explicitly to compare the same photo's detections.
- The worker selects only
  `PARKMAP_WORKER_SOURCE=/data/photos/branch-match-d42d251f9`, containing
  `20261021_1201.jpg`. Other production photos were preserved. This image's
  capture time remains `2026-10-21T12:01:00+07:00`.
- The active camera is `SPU_CAM_01`. Production lot version 7 uses the shared
  snapshot's geometry, equal to local lot version 9; version numbers belong to
  each database. Calibration is
  `files-sha256:ee05bf50e987aa47454b017b02a350c9bc5ded303dbecf9847a345da7c58c6a6`.
- Previous configuration files were backed up under
  `/srv/parkmap-demo/config/.branch-backup-20261120-d42d251f9`. Previous lot and
  calibration versions remain in Postgres. The temporary sync application and
  one-time API import command were removed after use.

The image, calibration, lot geometry, model, resolution, and confidence must all
match before comparing production with a local map. Green remains a
`WIDTH_SUFFICIENT` preview, not proof of an unobstructed parking footprint.

## Server directory

The worker and the API read one directory on the VPS:

```text
/srv/parkmap-demo/
  config/   ground_plane_calibration.json, ground_plane_homography.json, parking_calibration.json
  models/   best.pt, yolo11m-seg.pt
  photos/   20261021_120138.jpg, the one Sripatum photo the worker shows
  photos-archive-20260925/   the seven 2026-09-25 photos, not mounted
```

The worker loops over every photo in `photos/`; with one photo it shows that photo continuously. To return to the seven-photo loop, move the archived photos back into `photos/` and restart `parkmap-worker`.

Photo names start with the local capture time (`YYYYMMDD_HHMM[SS]`, UTC+07:00). The worker cannot decode HEIC, so convert iPhone photos to JPEG first, named from the capture time, for example `sips -s format jpeg -s formatOptions 95 IMG.HEIC --out 20261021_120138.jpg`.

Root owns it, and containers run as uid 10001, so both containers can read it and neither can write to it. That keeps the files `register-calibration` fingerprints identical to the files the worker uses.

The feature-branch deployment on 2026-11-14 uses the official `yolo11m-seg.pt` for worker Seg inference, with `PARKMAP_SEGMENTATION_MODEL_PATH=/app/models/yolo11m-seg.pt` and `PARKMAP_SEGMENTATION_CLASS_ID=3`. The asset comes from `https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11m-seg.pt`; its SHA256 is `eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf`, matching the local model. The file remains outside Git and images. The API also mounts the existing server models directory at `/app/models`. Keep `best.pt` for older-image rollback.

Production Seg analysis on this VPS took about 30 seconds per frame during rollout. `PARKMAP_STATE_FRESHNESS_S=60` is therefore configured on the API at runtime for this recorded-photo demo; the default 15 seconds made the map alternate between `DEMO` and `STALE` between successful publications. This is not a live-camera latency target. `STILL_IMAGE_LOOP` source notices and the stale-state gate remain active.

## Copy files from the team Drive

1. Download the three calibration files, `best.pt`, and the photo folder from the team Drive to your laptop, laid out as `<drive-download>/config/`, `<drive-download>/models/best.pt`, and `<drive-download>/photos/`.
2. The VPS login user is not root, so stage the files in its home directory, readable only by that user:

   ```sh
   cd <drive-download>
   COPYFILE_DISABLE=1 tar -cf - config models photos \
   | ssh <user>@<vps> 'umask 077 && rm -rf ~/parkmap-demo-staging && mkdir ~/parkmap-demo-staging && tar -xf - -C ~/parkmap-demo-staging'
   ```

3. Move them into place with `sudo` and remove the staging copy:

   ```sh
   ssh -t <user>@<vps> 'sudo mkdir -p /srv/parkmap-demo && sudo cp -R ~/parkmap-demo-staging/. /srv/parkmap-demo/ && sudo chown -R root:root /srv/parkmap-demo && sudo chmod -R u=rwX,go=rX /srv/parkmap-demo && rm -rf ~/parkmap-demo-staging && sudo ls -lR /srv/parkmap-demo'
   ```

4. Delete the laptop copy.

Every photo must be 4032 x 3024, the calibration reference size. The worker refuses to start on any photo it cannot describe.

## Coolify resources

**`parkmap-api`.** Add a Directory Mount with source `/srv/parkmap-demo/config` and destination `/app/config`. The calibration editing endpoints cannot save there; production calibration changes go through the Drive and this runbook.

**`parkmap-worker`.** Create it in project `ParkMap`, environment `production`, with the same image, registry login, and network settings as `parkmap-api`: image `ghcr.io/parkmap-team/parkmap-api`, no domain, and no HTTP health check, because the worker serves no port.

| Directory Mount source | Destination |
| --- | --- |
| `/srv/parkmap-demo/config` | `/app/config` |
| `/srv/parkmap-demo/models` | `/app/models` |
| `/srv/parkmap-demo/photos` | `/data/photos` |

| Environment variable | Value |
| --- | --- |
| `PARKMAP_PROCESS` | `worker` |
| `PARKMAP_API_URL` | `http://parkmap-api:8000` |
| `PARKMAP_WORKER_TOKEN` | Same value as on `parkmap-api` |
| `PARKMAP_WORKER_PARKING_AREA_ID` | `sripatum-near-lot` |
| `PARKMAP_WORKER_SOURCE` | `/data/photos` |
| `PARKMAP_WORKER_HOLD_S` | `10` (optional; seconds each photo is shown) |

Set the repository variable `COOLIFY_APP_WORKER` to the application UUID before the first push to `main` that includes the deploy job; without it the deploy job fails.

## Register the site and calibration

In the `parkmap-api` terminal, once:

```sh
python -m app.manage create-site --site-id sripatum --name "Sripatum University" --latitude <lat> --longitude <lng>
python -m app.manage create-parking-area --site-id sripatum --parking-area-id sripatum-near-lot --camera-id sripatum-camera-1 --name "Near lot"
python -m app.manage set-lot-model --site-id sripatum --file fixtures/spu-cam-01-lot-model.json
python -m app.manage register-calibration --parking-area-id sripatum-near-lot
```

A deploy does not activate fixture changes. After a pull request changes `fixtures/spu-cam-01-lot-model.json` and its API deploy finishes, run the `set-lot-model` line again. It prints `Activated lot model version N` even when the new ROI is not a rigid placement of the registered calibration, which silently deactivates that calibration. Check <https://app.parkmap.dev/sites/sripatum> afterwards: motorcycles must show and the area must not report `NOT_CALIBRATED` or `CALIBRATION_MISMATCH`.

After any change to `/srv/parkmap-demo/config`, run `register-calibration` again, then restart `parkmap-worker`. Until both happen, the area reports `CALIBRATION_MISMATCH`. When a new calibration and a new lot model ship together, run `register-calibration` first and `set-lot-model` second, so the lot model is checked against the new calibration. The values and their basis are in [sripatum-measured-calibration.md](sripatum-measured-calibration.md).

## Remove the development site

Production lists only real sites. Once the Sripatum area shows `DEMO` in the LIFF app:

1. Stop and delete `parkmap-dev-publisher` in Coolify, delete the API scheduled task `seed-dev (run once)`, and delete the repository variable `COOLIFY_APP_DEV_PUBLISHER`.
2. In the `parkmap-api` terminal:

   ```sh
   python -m app.manage remove-site --site-id dev-site --confirm dev-site
   ```

   It deletes the site with its parking areas, calibrations, lot models, and stored states.
3. Check that `GET /api/sites` lists only `sripatum`, and record the date below.

## Start, stop, and check

- **Start or stop** `parkmap-worker` in Coolify. While it runs, the LIFF app shows the Sripatum area as `DEMO` with the recorded-demo label and each photo's time. After a stop, the area turns `STALE` once `PARKMAP_STATE_FRESHNESS_S` (API, default 15 s) passes, and it shows no regions.
- **Healthy log line:** `Published state observed at <photo time> (analysis <s> s, publish <s> s, dropped frames so far: <n>)`. If analysis plus publish approaches the freshness limit, the area flickers `STALE`; raise `PARKMAP_STATE_FRESHNESS_S` on the API.
- **Refused start:** `Worker cannot start: ...` or `Still-image loop cannot start: ...` means a missing mount, an empty photo directory, or a photo the calibration cannot describe. The worker exits without publishing; Coolify restarts it and logs the same line until the files are fixed. Stop it while you fix them.
- **Publish failures** are logged as `Frame skipped: ...`; the next photo is tried.

## After the final presentation

1. Stop and delete `parkmap-worker` in Coolify, and delete the repository variable `COOLIFY_APP_WORKER` together with the `deploy-worker` CI job.
2. Remove the Directory Mount from `parkmap-api` and redeploy it.
3. On the VPS: `rm -rf /srv/parkmap-demo`.
4. Confirm no laptop copies remain. The team Drive keeps the originals.
5. Record the date below.

## Log

| Date | Step | By |
| --- | --- | --- |
| 2026-10-15 | Copied the calibration files, `best.pt`, and the seven photos to `/srv/parkmap-demo`; created `parkmap-worker` with its mounts and variables; added the config mount to `parkmap-api` | Sayhigh, Claude Code |
| 2026-10-15 | Registered `sripatum` and `sripatum-near-lot` (lot model version 1, calibration `files-sha256:5cd7805c…`); the area reports `DEMO` | Sayhigh, Claude Code |
| 2026-10-15 | Deleted `parkmap-dev-publisher`, the `seed-dev (run once)` task, and `COOLIFY_APP_DEV_PUBLISHER`; removed `dev-site`. `GET /api/sites` lists only `sripatum` | Sayhigh, Claude Code |
| 2026-11-20 | Replaced the seven-photo loop with one photo, `20261021_120138.jpg` (4032 x 3024, converted from HEIC); moved the seven photos to `photos-archive-20260925`; restarted `parkmap-worker`. The new view is offset 20-30 px from 2026-09-25 1131, within the 25 px spread of the original seven, so the calibration is unchanged | Sayhigh, Claude Code |
