# Local virtual parking slots from segmentation

In Parking enable **แบ่งช่องกว้าง 1 ม. · ลึกตามแถว · ทดลอง** and press Analyze.
The original Physical Map remains available; this adds camera and top-down
experimental overlays. The operator API returns `evaluation_mode=VIRTUAL_SLOTS`,
`target_width_m=1` and `target_length_m=null`: depth varies per row and is supplied
on each candidate as `slot_length_m`.

## Dynamic geometry

Python uses the current calibrated metric row direction and depth. Reference
occupied footprints from both detectors remain obstacles; hiding a detector in
the UI does not change calculations. Existing family references are retained for
primary detections, with standard minimum dimensions; segmentation-only detections
use the standard reference. Image masks are never treated as ground footprints.

Within each row, free lateral intervals are found over the row's entire depth.
Each interval is split from its left edge in the row axis into non-overlapping
1 m wide rectangles, with depth equal to that row. A 6 m interval generates six
slots; 6.99 m generates six and leaves 0.99 m unused. Slot generation never rounds
up, extends a row or adds another clearance margin beyond the 1 m allocation.
`source_gap_width_m` preserves the original interval width for context.

These are virtual, frame-dependent suggestions, not painted, reserved or fixed
physical stalls. Positions and internal IDs can change with the frame's free
intervals. They are not a verified parking-capacity count. No saved row dimensions
or control points are altered by Analyze.

## Evidence and uncertainty

Each slot is independently checked against row/ROI containment, occupied geometry,
row uncertainty, valid image projection and known image occluders. A mask or box
intersecting one slot does not make every slot of the original interval unknown.
`SLOT_CLEAR` is green only when all these checks pass; `UNKNOWN` stays grey and
shows its reasons. A slot outside ROI is not made green by its 1 m width.
No segmentation evidence inside ROI means UNKNOWN with no green slots.

Current validated homography, row fingerprint, camera identity, frame resolution,
ROI and calibration version must agree, otherwise CALIBRATION_REQUIRED withholds
green. MEASURED/ESTIMATED is supplied provenance, not independent verification of
real-world accuracy. Reference sizes, ground anchors and detector misses remain
limitations. Unmodelled obstacles and hidden ground must not be inferred as free.

## Family suggestions and display

### Incoming vehicle width

The operator can enter **ความกว้างรถที่จะเข้าจอด** and press Analyze. The private
Analyze form accepts `incoming_width_m` (finite, greater than zero, at most 5 m),
and automatically includes segmentation/gap analysis. Invalid widths are rejected
before detection. Python reuses the same frame/geometry without another inference.

The 1 m template grid remains visible. Separate recommendations allocate
`max(1 m, entered width)` from continuous free intervals, so a 1.20 m vehicle can
cross template lines instead of being rejected by individual 1 m cells. Row depth,
ROI, occupancy and visibility checks remain required. `incoming_vehicle` contains
the entered width, allocated width, per-position geometry and capped counts.
Only SLOT_CLEAR positions are suggested; uncertain positions are counted but
not promoted. These are not verified accessible parking spaces.

Cyan outlines and a dedicated result list show incoming positions, with selection
shared between image and top-down views. Changing input clears stale results;
another Analyze is required. Vehicle length and access are not checked. A future
classifier can resolve a family to a width and feed this same boundary; automatic
incoming classification is not implemented here.

Browser check with manual width (from tools/calibration-ui):

```powershell
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 ../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg yolo11n_cls --gaps --incoming-width=1.2
```

Selecting a green slot shows catalogue families whose exact reference widths
fit its 1 m width. Python reads `config/motorcycle_reference_sizes.json` on every
Analyze. Suggestions include reference width, remaining total lateral clearance
and provenance. Per-family length, access paths and manoeuvring are not checked;
the row depth shown is not proof that the suggested full motorcycle fits.
Suggestions are individual choices, not simultaneous vehicle capacity. Invalid
rules retain geometry with a separate error; non-green slots have no suggestions.

The new map defaults to ROI bounds and ROI-clipped segmentation vehicle shapes.
Detector/outside-ROI controls are display-only. Both detector layers can show the
same vehicle twice. SPU rows display 5 to 1; zoom, slot selection and status colours
are shared with the camera view. Blue marks selection without replacing status.
Red shapes are reference vehicles, purple is row geometry, green/grey are virtual
slots, and neutral background has no availability claim. The list shows slot
width/depth and failure reasons; only the selected slot has a map distance label.

At most 200 slots and 200 diagnostic intervals are returned. `truncated=true`
means additional results were omitted, not that the omitted area is occupied.
Legacy full-standard-footprint and midline-width helpers remain tested diagnostics;
the operator route uses virtual slots. Standard analysis, worker, persisted state
and LIFF are unchanged. Training stays terminal-only.

## Verification

Tests cover six independent slots, remainder handling, row depths 1.46/1.90 m,
non-overlap, per-slot occlusion, deterministic IDs, limits, reference-width family
matching, invalid rules, stale calibration, wrong image resolution and legacy
fitting regressions.

```powershell
cd tools/calibration-ui
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 ../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg yolo11n_cls --gaps
```
