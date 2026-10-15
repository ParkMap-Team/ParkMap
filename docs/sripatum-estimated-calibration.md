# Sripatum estimated calibration

Status: `ESTIMATED`, 2026-10-15 (#26). It makes no distance or accuracy claim (ADR 0004, ADR 0011). #17 replaces every value below with a survey.

## Identity

| Item | Value |
| --- | --- |
| Site | `sripatum` |
| Parking area | `sripatum-near-lot` |
| Camera | `sripatum-camera-1` |
| Reference photo | `20260925_0931` (4032 x 3024, the least occluded of the seven) |
| Calibration files | `ground_plane_calibration.json`, `ground_plane_homography.json`, `parking_calibration.json`, kept on the team Drive, never in Git |
| Lot model | [`apps/vision-api/fixtures/sripatum-lot-model.json`](../apps/vision-api/fixtures/sripatum-lot-model.json) |

## Ground frame

Local frame in metres. `x` runs along the hedge, to the right in the photo. `y` runs away from the camera toward the hedge, so the standard motorcycle footprint extends from a detected rear wheel toward the hedge.

The lot was flooded and could not be surveyed, so the frame rests on two assumptions taken from the painted car-stall grid:

1. **Stall pitch 2.5 m.** The painted dividers repeat at one pitch. Thai car stalls are 2.4 to 2.6 m wide, so lateral values carry about 4 % scale uncertainty from the centre divider. Motorcycle mirror widths in the photo agree to within 0.1 m.
2. **Transverse-line spacing 5.0 m.** The three solid transverse lines `L0` (hedge side), `L1`, and `L2` are equally spaced on the ground: the perspective spacing ratio is the same whatever the lens focal length. Their spacing is taken as the standard car-stall depth. The photo has no EXIF, so the lens is unknown; pole leans allow the depth scale to be up to about 30 % larger. Hedge-row motorcycles fit the 2.0 m standard footprint on this scale.

## Control points

Each point is a painted divider crossing a transverse line, traced in the reference photo. Pixel positions are in reference-photo pixels; the calibration stores them normalized.

| Id | Image px (x, y) | Ground m (x, y) | Uncertainty m |
| --- | --- | --- | --- |
| `L0_U_c` | 988, 1921 | 5, 13 | 2.65 |
| `L0_U_d` | 1630, 1923 | 10, 13 | 2.65 |
| `L0_U_e` | 2267, 1926 | 15, 13 | 2.6 |
| `L0_U_f` | 2927, 1928 | 20, 13 | 2.65 |
| `L0_U_g` | 3256, 1929 | 22.5, 13 | 2.65 |
| `L1_U_c` | 840, 2198 | 5, 8 | 1.45 |
| `L1_U_d` | 1559, 2199 | 10, 8 | 1.4 |
| `L1_U_e` | 2278, 2200 | 15, 8 | 1.35 |
| `L1_U_f` | 3011, 2201 | 20, 8 | 1.4 |
| `L1_U_g` | 3382, 2201 | 22.5, 8 | 1.4 |
| `L2_B_a` | 643, 2566 | 5, 3 | 0.5 |
| `L2_B_b` | 1467, 2565 | 10, 3 | 0.35 |
| `L2_B_c` | 2290, 2563 | 15, 3 | 0.25 |
| `L2_B_d` | 3127, 2562 | 20, 3 | 0.35 |
| `L2_B_e` | 3548, 2561 | 22.5, 3 | 0.4 |

Uncertainty is `0.1 + hypot(0.04 * |x - 15|, 0.25 * |y - 3|)`, at least 0.25 m: pitch error grows from the centre divider and depth-scale error grows from `L2`. Homography fit: `VALIDATED`, RMSE 0.06 m, maximum 0.11 m. The fit only shows the traced points agree with each other, not with the ground.

## Parking ROI and virtual rows

The Parking ROI is the ground rectangle `x` 3.93 to 21.18, `y` 1.12 to 14.08. It ends at the hedge curb, stops short of the trees on both sides, and stops above the near planters, whose plants hide the motorcycles behind them.

| Row | Ground `y` m | Basis |
| --- | --- | --- |
| `row_1` Hedge row | 11.08 to 14.08 | Motorcycles parked nose-in at the curb. 3.0 m deep because their rear wheels sit near the estimated edge. |
| `row_2` Middle row | 6.11 to 8.61 | Rear wheels on dashed line `D1` (`y` about 6.4). |
| `row_3` Planter row | 1.18 to 3.68 | Rear wheels on dashed line `D2` (`y` about 1.5). |

Every row spans the ROI width (17.25 m) and is `ESTIMATED` with 1.0 m uncertainty. Positions were checked against the occupied photo `20260925_1521`.

## Lot model

The outline is the whole lot, `x` -8.35 to 37.5, `y` -14.7 to 14.08: from the west planters to the hedge curb, and from the covered walkway to the far end of the lot. The parking area is the Parking ROI. The rest of the outline, including the half of the lot the camera does not see, is `UNMONITORED`.

Every landmark is `ESTIMATED` from a satellite image of the campus and the team's site photos, not surveyed. The team marked the lot, the camera's view, and the shared entrance and exit on the satellite image. Its scale was set from the lot's painted stall grid (about 0.069 m per pixel, uncertain by up to 30 %), and it was aligned to the ground frame by the hedge curb (`y` 14.08) and the near planter tops (`y` 0.96):

```text
x_m = (row_px - 233) * 0.069
y_m = 0.96 + (column_px - 770) * 0.069
```

| Landmarks | Basis |
| --- | --- |
| `entrance-exit` | The team's mark on the satellite image. No `direction_rad`: the direction of travel is not confirmed. |
| `guard-booth` | Roof visible beside the entrance on the satellite image. |
| `hedge`, `central-planters`, `west-planters-*` | Planting lines on the satellite image; heights from the site photos. |
| `central-tree-*`, `west-tree-*` | Canopies on the satellite image; heights and canopy radii from the site photos. |
| `west-sidewalk`, `*-road`, `*-lawn`, `north-covered-walkway` | Surfaces and roof visible on the satellite image. |
| `building-9-podium`, `building-9` | อาคาร 9: footprints on the satellite image; heights from storey counts in the site photos (about 3.6 m a storey); facades from the site photos, a brick-and-glass podium under a white tower with a window band on every storey. |

Only features visible in the images are modelled, and no raised landmark overlaps the parking area. The map labels the surroundings as estimated from photos. The satellite image and the photos stay off Git.

## Photos sharing the calibration

Projecting each photo's traced control points through the reference homography gives its viewpoint drift. All seven photos share the calibration because every point's drift stays within that point's uncertainty (worst ratio 0.92, photo `20260925_1100`).

| Photo | RMSE m | Max m |
| --- | --- | --- |
| `20260925_0931` | 0.06 | 0.11 |
| `20260925_1000` | 0.22 | 0.34 |
| `20260925_1030` | 0.10 | 0.20 |
| `20260925_1100` | 0.20 | 0.26 |
| `20260925_1131` | 0.25 | 0.50 |
| `20260925_1226` | 0.19 | 0.25 |
| `20260925_1521` | 0.17 | 0.35 |

## Registering

From `apps/vision-api` with the calibration files in `config/`. The site coordinates are the campus parking entrance, supplied by the team:

```bash
uv run python -m app.manage create-site --site-id sripatum --name "Sripatum University" --latitude <lat> --longitude <lng>
uv run python -m app.manage create-parking-area --site-id sripatum --parking-area-id sripatum-near-lot --camera-id sripatum-camera-1 --name "Near lot"
uv run python -m app.manage set-lot-model --site-id sripatum --file fixtures/sripatum-lot-model.json
uv run python -m app.manage register-calibration --parking-area-id sripatum-near-lot
```

## What #17 replaces

- Every control point: survey the same divider crossings, or any four or more non-collinear ground marks, and record them as `MEASURED`.
- The stall pitch and transverse-line spacing assumptions, which the survey makes unnecessary.
- `row_1` to `row_3` lengths and widths, measured on the ground.
- The lot model, recomputed in the measured frame. Keep the parking area id.
- Landmarks: measure the entrance and exit, the guard booth, and the planting lines bounding the lot, and record them as `MEASURED`. Set an entrance or exit `direction_rad` only when the direction of travel is confirmed on site. Replace the satellite-derived surroundings with the survey or an openly licensed map such as OpenStreetMap.
