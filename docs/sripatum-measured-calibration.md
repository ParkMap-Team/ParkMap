# Sripatum measured calibration

Status: `MEASURED`, active in production from 2026-11-12. It replaces the [estimated calibration](sripatum-estimated-calibration.md). A teammate measured the control points and rows on site with a tape measure and calibrated them in the calibration UI (homography calculated 2026-09-30). The team confirmed the measurement on 2026-11-12; the measurement notes are not in the repository.

## Identity

| Item | Value |
| --- | --- |
| Site | `sripatum` |
| Parking area | `sripatum-near-lot` |
| Camera | `sripatum-camera-1`. The calibration UI saved it as its default `SPU_CAM_01`; production renamed it to match the parking area and recalculated the homography, whose source fingerprint includes the camera id. The matrix, ROI and rows did not change (largest difference 1e-12). |
| Reference image | 4032 x 3024, the same viewpoint as the seven still-image loop photos |
| Calibration files | `ground_plane_calibration.json`, `ground_plane_homography.json`, `parking_calibration.json`, kept on the team Drive, never in Git |
| Lot model | [`apps/vision-api/fixtures/spu-cam-01-lot-model.json`](../apps/vision-api/fixtures/spu-cam-01-lot-model.json) |

## Ground frame

Local frame in metres. `x` runs to the right in the photo. `y` runs away from the camera: `P1` and `P2` are on the near side, `P3` and `P4` 14 m further away.

## Control points

Pixel positions are in reference-image pixels; the calibration stores them normalized. Every point is `MEASURED`.

| Id | Image px (x, y) | Ground m (x, y) | Fit error m |
| --- | --- | --- | --- |
| `P1` | 578, 2680 | 0, 0 | 0.13 |
| `P2` | 3590, 2670 | 14, 0 | 0.31 |
| `P3` | 3249, 1931 | 14, 14 | 0.06 |
| `P4` | 980, 1898 | 0, 14 | 0.24 |
| `P5` | 1492, 2442 | 4, 4 | 0.31 |
| `P6` | 2283, 2456 | 8, 4 | 0.50 |
| `P7` | 2273, 2200 | 8, 8 | 0.12 |
| `P8` | 1558, 2181 | 4, 8 | 0.28 |

Homography fit (`NORMALIZED_DLT_SVD`): `VALIDATED`, RMSE 0.28 m, maximum 0.50 m.

Projected through the estimated calibration, the eight points land on the painted grid, which confirms the shared viewpoint. Distances between them in the estimated frame are 0.79 to 1.26 times the measured ones (median 1.06), so values from the estimated calibration must not be mixed with this one.

## Parking ROI and rows

The Parking ROI has six vertices: (-3.51, 14.03), (14.04, 14.02), (14.14, 0.13), (-1.24, -0.03), (-1.24, 7.94), (-3.68, 8.13). The notch on the left keeps the near rows to 15.3 m.

| Row | Ground `y` m | Measured length x width m |
| --- | --- | --- |
| `row_1` | 0.10 to 1.87 | 15.32 x 2.0 |
| `row_2` | 1.76 to 3.98 | 15.32 x 2.0 |
| `row_3` | 5.80 to 7.91 | 15.32 x 2.0 |
| `row_4` | 8.05 to 10.04 | 18.0 x 2.0 |
| `row_5` | 11.51 to 14.02 | 18.0 x 2.0 |

## Lot model

`spu-cam-01-lot-model.json` is the model the operator drew in the lot model editor on 2026-10-30, unchanged. Its outline is the parking area. The parking area is the calibrated ROI turned half a turn and moved (rotation -3.1408 rad, `dx` 24.23 m, `dy` 14.00 m), a rigid placement the API accepts without deactivating the calibration. Its 15 surroundings are `ESTIMATED` and sketched in the editor, not measured; `central-planters` touches the ROI edge by 2.3 cm. Moving, resizing or mirroring the parking area deactivates the calibration (ADR 0013).

## Registering and replacing

Copy the three files to `/srv/parkmap-demo/config` as in the [runbook](still-image-loop-runbook.md#copy-files-from-the-team-drive). Then, in the `parkmap-api` terminal, register the calibration before the lot model, because `set-lot-model` checks the parking area against the active calibration:

```sh
python -m app.manage register-calibration --parking-area-id sripatum-near-lot
python -m app.manage set-lot-model --site-id sripatum --file fixtures/spu-cam-01-lot-model.json
```

Restart `parkmap-worker`, then check <https://app.parkmap.dev/sites/sripatum>: motorcycles show and the area reports neither `NOT_CALIBRATED` nor `CALIBRATION_MISMATCH`.
