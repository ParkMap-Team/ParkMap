# Local segmentation gap and clearance experiment

In Parking enable **หาช่องว่างและระยะ · เฉพาะความกว้าง 0.66 ม. · ทดลอง**
and press Analyze. It enables segmentation comparison too. Green polygons are
**WIDTH_SUFFICIENT corridors**, not full-vehicle FIT candidates, physical stalls,
simultaneous capacity or guaranteed safe parking. Grey polygons are UNKNOWN.
All measured width gaps, including narrow ones, are returned as candidates.
`INSUFFICIENT_WIDTH` is red when the geometry/visibility checks otherwise pass;
uncertainty or occlusion takes precedence as UNKNOWN. The response's `narrow_count`
counts red gaps, while `green_count` never includes them. An open list below the
2D map shows every returned gap's width and Thai status, grouped by row 5 to 1.
Selection adds a blue outline and never replaces the state colour. The map itself
still labels only the selected distance to avoid overlapping text.
Worker, saved states, the standard result and LIFF remain unchanged.

Select a polygon/button for its corridor width. The line keeps its state colour.
There is one polygon per gap, not one polygon per potential motorcycle.
No extra clearance margin is added. Width is the existing lateral parking pitch,
not measured body width or a claim of comfortable manoeuvring. An expandable list
also reports widths, including narrow ones. Width-only mode measures in a 2 cm
band centred on the row midline (or the full row depth if it is smaller). This
is a local transverse measurement, not proof of a full-depth corridor or a
vehicle placement. The target motorcycle length is not checked.

Purple outlines and row-ID labels show the exact metric rows used in fitting,
projected by Python into the image. The **แสดงกรอบแถว (row)** switch starts on
and can hide them without rerunning analysis. These are configured analysis
regions, not painted physical stalls. Invalid/out-of-image projections are omitted.

A separate **2D มุมบน · ช่องว่างจาก segmentation (ทดลอง)** view appears below
the segmentation photo when gap analysis is enabled. The existing Physical Map
remains available unchanged. Python supplies metric ROI, row outlines, individual
reference footprints (from both detectors) and candidate polygons/width lines.
The new view keeps a uniform metre scale, supports zoom/scroll and shares gap
selection with the photo/readout. By default its frame uses only ROI bounds.
The metric Y axis increases upward, placing the SPU rows from row_5 at the top
to row_1 at the bottom. All shapes share that display transform; text stays upright.
By default the view
shows YOLO11m-seg footprints clipped in Python to ROI. A detector selector switches
display layers; **แสดงรถนอก ROI** explicitly expands the frame to the selected
detector's full footprints. These are display controls only: both models still
block geometry and visibility. Only the selected gap has a distance label.
Green/grey gap strokes indicate the measurement band, not a parking-sized area.
Red shapes are occupied references; overlapping
detections from the two models can represent the same motorcycle twice. They are
not unique-vehicle counts. Green/grey come directly from backend states; neutral
background is not confirmed free space. Switching viewpoint or detector display
does not change measurement or remove occlusion gates. Missing calibration shows an explanation, not an
invented map.

## Decision and geometry

Projecting object masks onto the ground was considered alongside reusing
calibrated reference footprints. The implementation chooses reference footprints
with image-space visibility checks: vehicle surfaces lie above the ground plane,
so mask outlines cannot establish metric ground footprints.

`analyze_segmentation_gaps` runs existing Python fitting/capacity on the
conservative union of both detectors. A motorcycle missed by one remains blocking
if found by the other. Duplicates can over-block; no unverified matching deletes
them. Larger known class references are retained for original detections, and no
occupied reference is shrunk below standard. Segmentation-only vehicles use
standard references. Ground anchors/undirected axes keep existing approximations.
Only incoming target width (0.66 m) is checked. The API returns
`evaluation_mode=WIDTH_ONLY`; `target_length_m` retains the standard reference for
compatibility but is not an acceptance criterion. The pure geometry helper also
retains full-footprint mode for regression checks.

Width gaps come from lateral intervals free of occupied reference footprints
at the row's middle cross-section band. They do not depend on full-vehicle fitting
placements, so a row shorter than 2 m can pass the width check. Full row/ROI
containment and no occupied overlap are still required. Current validated
homography, row fingerprint, camera identity,
reference resolution, ROI projection and before/after calibration hash must agree.
Otherwise the result is CALIBRATION_REQUIRED. MEASURED/ESTIMATED describes supplied
calibration provenance; estimated distances are approximate and neither source
establishes individual vehicle geometry.

Green additionally requires a clear row and an entirely valid image projection.
Projected candidates overlapping any known motorcycle image mask **or box from
either detector** are UNKNOWN because ground may be occluded. No segmentation
evidence inside ROI means UNKNOWN, not an empty lot. Both detectors can still
miss vehicles; unrecognised obstacles, unmodelled occlusion, wrong camera-view
assumptions and reference-size/anchor errors remain limitations. ROI must exclude
unobserved ground/obstacles. A locked human-reviewed reference set is still needed.

At most 200 candidates and 200 measurements are returned. Browser code
draws server states/geometry/distances; it never recomputes availability. The
private Analyze option `include_segmentation_gaps=true` implies segmentation and
returns a separate `segmentation_gaps` result. Missing segmentation yields UNKNOWN
with zero green candidates. No extra model training or live publication occurs.

Tests cover width-only short rows, insufficient width, legacy full-fit depth
checks, occlusion, uncertainty, missing
evidence, invalid projection, ROI, primary-only vehicles, larger references,
unchanged inputs, stale calibration and wrong resolution. Real browser check:

```powershell
cd tools/calibration-ui
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 ../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg yolo11n_cls --gaps
```
