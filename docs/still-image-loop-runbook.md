# Still-image loop runbook

How production runs the Sripatum still-image loop demo ([ADR 0011](adr/0011-still-image-loop-demo-on-estimated-calibration.md)). The photos, detector weights, and calibration files are private: they move from the team Drive to the server by hand and never enter Git, an image, a ticket, or a log.

## Server directory

The worker and the API read one directory on the VPS:

```text
/srv/parkmap-demo/
  config/   ground_plane_calibration.json, ground_plane_homography.json, parking_calibration.json
  models/   best.pt
  photos/   the seven Sripatum photos, names unchanged (YYYYMMDD_HHMM...)
```

Root owns it, and containers run as uid 10001, so both containers can read it and neither can write to it. That keeps the files `register-calibration` fingerprints identical to the files the worker uses.

## Copy files from the team Drive

1. Download the three calibration files, `best.pt`, and the photo folder from the team Drive to your laptop.
2. Copy them to the VPS:

   ```sh
   ssh root@<vps> 'mkdir -p /srv/parkmap-demo/config /srv/parkmap-demo/models /srv/parkmap-demo/photos'
   scp <drive-download>/config/*.json root@<vps>:/srv/parkmap-demo/config/
   scp <drive-download>/best.pt root@<vps>:/srv/parkmap-demo/models/
   scp <drive-download>/photos/* root@<vps>:/srv/parkmap-demo/photos/
   ssh root@<vps> 'chown -R root:root /srv/parkmap-demo && chmod -R u=rwX,go=rX /srv/parkmap-demo'
   ```

3. Delete the laptop copy.

Every photo must be 4032 x 3024, the calibration reference size. The worker refuses to start on any photo it cannot describe.

## Coolify resources

**`parkmap-api`.** Add a Directory Mount with source `/srv/parkmap-demo/config` and destination `/app/config`. The calibration editing endpoints cannot save there; production calibration changes go through the Drive and this runbook.

**`parkmap-worker`.** Create it in project `ParkMap`, environment `production`, with the same image, registry login, and network settings as `parkmap-dev-publisher`: image `ghcr.io/parkmap-team/parkmap-api`, no domain, and no HTTP health check, because the worker serves no port.

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
python -m app.manage set-lot-model --site-id sripatum --file fixtures/sripatum-lot-model.json
python -m app.manage register-calibration --parking-area-id sripatum-near-lot
```

After any change to `/srv/parkmap-demo/config`, run `register-calibration` again, then restart `parkmap-worker`. Until both happen, the area reports `CALIBRATION_MISMATCH`. The values and their basis are in [sripatum-estimated-calibration.md](sripatum-estimated-calibration.md).

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
