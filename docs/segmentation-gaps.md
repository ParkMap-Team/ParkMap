# Active mode: rectangular continuous gaps

### Horizontal vehicles and nearest reference distance

Parking displays a separate horizontal-vehicle diagnostic by default in camera
and metric maps. It considers all original Seg detections, including ones excluded
from row ownership. Pixel bbox width/height >=1.15 proposes a horizontal axis;
this is not inferred true ground heading. Original Seg IDs are retained.
Horizontal references are 2.00 m across and 0.66 m deep, anchored at projected
bbox bottom-centres; vertical references keep the existing 0.66-by-2.00 m
assumption. These are proxies, not measured dimensions or projected mask shapes.

Python finds the shortest Euclidean segment to the nearest comparable reference.
Comparable neighbors have sufficiently clear image aspect and complete footprints
inside the calibrated ROI. Ambiguous, invalid or outside references are counted
as excluded neighbors, never silently asserted absent. Both endpoints and the
whole measurement segment must stay in ROI and project to valid image coordinates;
otherwise no metre value is supplied. Overlapping references yield 0 m without
claiming actual vehicles collide. No comparable neighbor means no measurement.

Orange dashed references need not be in virtual rows. Selecting one or its Seg ID
shows a blue neighbor and an approximate metre label. No gap geometry, green/yellow
status, incoming recommendation, worker or LIFF fitting consumes these results.
Positions, dimensions and image aspect remain uncertain even with measured
calibration. The diagnostic does not determine access or guaranteed parking.

Verify with `pytest tests/test_horizontal_vehicle_service.py` and, with local
servers/model, run the browser script from tools/calibration-ui:
`node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 <image> --horizontal-only --screenshot`.

### Continuous row intervals

In Parking, click any Seg motorcycle mask (or its fallback box) to inspect its
original detection ID, image bottom-centre, recorded owner row/association and
distance, presence of a red reference band, or scope exclusion. Orange outlines
link the image and existing metric reference. A dropdown exposes every detection,
including overlapping masks and excluded vehicles; selection resets for a new
result. UI diagnostics present backend decisions only and never infer an owner
from image overlap. Missing records/calibration are reported explicitly. Verify
with `node scripts/test-classifier-ui.mjs <ui-url> <image> --inspect-only`.

Selected detections also expose the exact row-distance witness supplied by
Python: a pink cross at the bbox bottom-centre, white endpoint on the nearest
eligible finite lower edge, and a connecting line labelled in centimetres on both
image and metric maps. `nearest_row_id` is the measured edge, not necessarily an
accepted owner. Rejected points can still show the witness. No eligible span means
no fabricated line; failed image projection keeps the image witness absent.
These fields and overlays do not change row association or availability. Verify
with the browser script's `--inspect-only --row-distance` flags.

Each uninterrupted free row corridor is one full-width candidate with a single
distance witness in metres. Local uncertainty envelopes no longer split a continuous gap
into artificial sub-intervals. If any part remains uncertain or occluded, the
whole candidate keeps UNKNOWN with its evidence; width-only preview may hatch
the full interval green when its total width is sufficient. Real occupied
vehicle bands still separate gaps. No interval is promoted to confirmed green
by merging, and worker/LIFF fitting is unchanged.

The metric map no longer draws orange dashed uncertainty-envelope circles or
their display toggle. Backend uncertainty envelopes, UNKNOWN gates and reasons
remain unchanged; removing this overlay never changes parking decisions.

Parking runs YOLO11m-seg and gap analysis by default after Analyze; no comparison
or classifier selection is required. The primary detector is segmentation for
both uploaded images and sampled video frames. Existing detection/map views use
the same Seg boxes. Missing weights produce an explicit error with no fallback
to the original detector. Classification and class-derived dimensions are not
part of this web flow; incoming width remains a manual input. Worker/LIFF remain
unchanged.

### Scope of reference occupancy

Active Parking Analyze uses IMAGE_NEAREST_LOWER_EDGE. The bbox bottom-centre
selects the closest finite lower row edge in image pixels, even when the point
falls inside another row polygon. The perpendicular projection must fall inside
the edge's width span. The winning edge must lead the runner-up by more than 5%
of the smaller candidate row's image depth (polygon area / edge length); otherwise
association stays unresolved. This tolerance is experimental and not surveyed.
Points outside calibrated ROI by more than 0.40 m are excluded; points inside
ROI have no 20 cm cutoff. Masks do not rank or validate row owners in this mode.
Saved geometry and calibration remain unchanged.

An accepted detection reserves one lateral band in its owner row, centred on
its projected anchor and aligned with the lower edge, using the existing reference
width (standard 0.66 m) and full measured row depth. The band is clipped to row/ROI.
It no longer requires the old two-metre footprint to intersect that row. A vehicle
cannot reserve another row just because its original reference points that way.
This is approximate row bookkeeping, not a measured physical vehicle footprint.
Original complete references remain available in the layer geometry for inspection.

Assignments report IMAGE_NEAREST_EDGE and ASSIGNED_BY_NEAREST_IMAGE_EDGE.
AMBIGUOUS_IMAGE_EDGES, OUTSIDE_ROW_SPAN and OUTSIDE_ROI explain exclusions.
Invalid metric references or empty clipped owner bands still cannot create
occupancy. Each original Seg ID retains a reason and metric distance witness;
accepted owners' witnesses reference the same chosen row, not an independently
ranked metric edge. The displayed metre distance does not impose a 20 cm cutoff.
All assignments remain uncertain, and calibration, fitting and image-occlusion
gates stay active. Excluded detections still occlude via valid masks/bbox fallback.

The superseded image-containment selector has been removed. BOTTOM_EDGE_ANCHOR
helpers remain legacy diagnostics. Worker/LIFF are unchanged. Virtual rows are not physical stalls.

Each rectangular candidate reports `width_blocking_detection_ids` for reference
vehicles touching its lateral interval endpoints. The inspector displays these
separately from actual image-mask occluders; row/ROI boundaries may also bound a
gap without a vehicle ID.

Legacy ambiguous references retain conservative uncertainty across rows. In active
anchor-only mode excluded detections remain image occluders. All calibration and
evidence gates remain active; assigning a row cannot
turn actual image occlusion green. The inactive irregular-shape route retains
its prior reference policy.

All original image masks/box fallbacks remain occluders, including excluded
vehicles. Source detection IDs/indices are preserved through filtering for
inspection. `occupancy_scope=GROUND_ANCHOR_OR_ROW_MASK` and
`excluded_detection_ids` report this policy. Uncertainty is calculated on the
scoped detection set, not filtered from an already computed row status. No
in-scope detections means UNKNOWN with no green. This is an operator scope rule,
not proof of access or real physical intrusion: a misplaced ground anchor still
requires calibration/anchor review, and real outside obstacles can remain a
limitation of the single-camera reference model.

The operator Analyze route uses CONTINUOUS_GAPS again, following operator review
of the irregular-patch display. Each candidate is a rectangle over the current
row depth, with width determined by free lateral intervals. It does not split
into fixed 1 m stalls. Full-depth obstacle, image-occlusion, row uncertainty and
calibration gates remain in force. Occluded/uncertain rectangles stay UNKNOWN.
Green checks width plus total lateral margin only; vehicle length/access remain
unchecked. Rectangles are the same in camera and metric views.

The metric map defaults to Python-supplied `row_depth_geometry` red display bands.
For each positive-area vehicle/row intersection, Python preserves its lateral
span along the authoritative row axis and extends the display band over that
row's depth, clipping it to row/ROI and retaining ROI holes. Boundary-only contact
does not create a band. These bands denote the lateral area withheld because of
a reference vehicle; they are not vehicle dimensions. SVG also clips the display
to row/ROI. Width calculations use the row-owned effective references described
above; the expanded display bands themselves never feed calculations. The existing outside-ROI
diagnostic switch can show full references; no extra action is needed for the
default full-depth display. Camera detections and masks retain their image shapes.

The VISIBLE_FREE_SHAPES mode documented below is an inactive diagnostic; it is
retained with tests but is not selected by the operator Analyze route.

# Local visible free-ground shapes from segmentation

The inactive visible-shape diagnostic described here was previously selectable by the operator route.
The original Physical Map remains available; this adds camera and top-down
experimental overlays. This diagnostic returns `evaluation_mode=VISIBLE_FREE_SHAPES`,
`target_width_m` equal to the incoming width (default 0.66 m), and `target_length_m=null`. Candidates preserve polygon rings in `geometry_metric` and `geometry_image`; legacy exterior-only fields must not be used to fill these shapes.

## Dynamic geometry

Python uses the current calibrated metric row direction and depth. Only
YOLO11m-seg detections create occupied reference footprints in this experiment;
primary detections/classifier references never enter this calculation or transfer
dimensions by detection index. Segmentation vehicles use the standard footprint.
The normal detector/classifier panels still run independently. The API marks
`occupancy_source=SEGMENTATION_ONLY`. Masks are never ground footprints.

Within each row, Python subtracts canonical occupied reference footprints from
row intersected with ROI. It retains the remaining polygon parts and holes,
instead of discarding a whole lateral interval when one vehicle occupies only
part of the row depth. Free-ground shapes are projected into the image and
partitioned by validated occluders; the ground visibility portions are mapped
back using the calibrated homography. This does not project vehicle silhouettes
into occupied ground footprints. Occluded parts remain UNKNOWN, and localized
uncertainty envelopes partition the remaining patches separately. Failed or
incomplete round trips retain the original patch as UNKNOWN.

Width is a contained cross-section parallel to the row axis, sampled at interior
mid-heights between polygon vertices (at most 128 samples). It never joins spans
across a hole or uses a bounding-box width as proof of sufficient space. A witness
meeting vehicle width plus total lateral margin can pass only after every evidence
gate passes. If no sampled witness suffices but the upper bound still permits a
wider section, the result is WIDTH_NOT_PROVEN, not proven narrow. There is no
minimum 1 m allocation, rounding, full-footprint fit or capacity claim.

depth_at_width_midpoint_m and depth_line_metric/image describe the contained
perpendicular span at the width witness midpoint. This is context, not a depth
proven along the full width or a vehicle-length fit; slot_length_m remains null.
Green means this shape contains a sufficient width witness, not that every point
inside it is a valid motorcycle placement. Narrow visible patches can be red;
uncertain or hidden patches stay grey. Zero margin is not a validated safe margin.

These are virtual, frame-dependent suggestions, not painted, reserved or fixed
physical stalls. Positions and internal IDs can change with the frame's free
intervals. They are not a verified parking-capacity count. No saved row dimensions
or control points are altered by Analyze.

## Evidence and uncertainty

Each interval is checked against row/ROI containment, occupied geometry,
localized assignment uncertainty, valid image projection and known image occluders.
Valid nonzero, simple Seg polygons inside the bounding box (one-pixel tolerance)
replace that detection's box as image occluders. Missing, degenerate,
self-intersecting or out-of-box polygons use the box instead; no occluder is silently
removed. The occluded intersection is retained as UNKNOWN while independently visible
remainders are evaluated. WIDTH_SUFFICIENT is green only when all checks pass.
Narrow visible patches are INSUFFICIENT_WIDTH; uncertainty takes precedence as
UNKNOWN, including narrow patches. No gates are bypassed.
Rows expose uncertainty reasons, affected detection IDs and `uncertainty_scope`.
For assignment-only ambiguity with resolvable valid anchors/footprints, Python
builds a circular envelope about each anchor with radius
`hypot(reference_width/2, reference_length) * 1.001`. The polygon circumscribes the
reference rectangle at any heading under the existing anchor/size assumptions.
This is an experimental bound, not a surveyed limit on real vehicle position/size.
Each candidate intersecting an envelope stays UNKNOWN with `LOCAL_ROW_UNCERTAINTY`
and the responsible `uncertain_detection_ids`; envelopes also affect neighboring rows.
Other candidates do not inherit a whole-row assignment gate. Unresolved IDs,
invalid transforms, unknown uncertainty causes or failed validation retain the
whole-row/global gate. Masks, evidence and calibration gates are never waived.
`uncertainty_regions` provides the exact envelopes for dashed orange display.
Reference footprints remain aligned to the metric Y axis; this implementation
does not estimate real motorcycle heading. That limitation can affect row assignment,
occupied geometry and the conservative free-space result.
No segmentation evidence inside ROI means UNKNOWN with no green slots.

Current validated homography, row fingerprint, camera identity, frame resolution,
ROI and calibration version must agree, otherwise CALIBRATION_REQUIRED withholds
green. MEASURED/ESTIMATED is supplied provenance, not independent verification of
real-world accuracy. Reference sizes, ground anchors and detector misses remain
limitations. Unmodelled obstacles and hidden ground must not be inferred as free.

## Family suggestions and display

### Display-only bbox orientation experiment

The **ทดลองเดาแนวรถจากกรอบภาพ** switch defaults off and uses Python's
`orientation_hypotheses` for reference detections overlapping the current ROI.
The ratio is `(normalized bbox width * image width) / (normalized bbox height *
image height)`, so nonsquare image dimensions are respected. A ratio >= 1.15
proposes HORIZONTAL_IMAGE and a 90-degree rotation; <= 1/1.15 proposes
VERTICAL_IMAGE and zero rotation; the intermediate band is AMBIGUOUS_IMAGE with
no proposed rectangle. These thresholds are experimental, not trained/validated.

Proposed metric rectangles retain reference area and centre and rotate about the
original centroid, not an inferred wheel anchor. Dashed cyan outlines compare
the horizontal proposals with red canonical footprints on the 2D map and photo;
the selected vertical proposal can also be inspected. Near-square proposals are
listed as uncertain. Invalid image projection omits the photo outline.
`orientation_display_only=true` is explicit: all occupied footprints, gap geometry,
occlusion/uncertainty gates, availability states/counts, worker and LIFF continue
using the original analysis. This is an image-aspect heuristic, not true ground
heading or a way to turn a one-camera mask into measured 3D geometry. Review
against human-labelled examples before any future fitting integration.

### Inspecting camera-view occlusion

For each valid projected candidate, Python intersects its image polygon with the
same validated masks/box fallbacks used by the occlusion gate. `occlusion_evidence`
contains the normalized image intersection polygons (including disconnected parts
and holes), source detection ID/index, MASK or BBOX_FALLBACK kind and the fraction
of candidate image area covered by that individual source. Percentages are not
metric ground area and overlapping sources are not additive. At most 12 source
records are returned per candidate; `occlusion_evidence_truncated` reports the cap.
`occlusion_evidence_available=false` means details cannot be evaluated or were not
supplied, never proof of no occlusion. The UNKNOWN gate and all counts are unchanged.

Select a gap in the 2D map or camera overlay to inspect it below the 2D map in
**ตรวจการบังบนภาพจริง**. Magenta shows the exact image-space overlap, orange outlines
its source mask/fallback and blue outlines the projected gap. A context crop keeps
the original image aspect ratio; source buttons focus the crop on one motorcycle.
The overlay switch affects display on both the full photo and crop only. No mask
is converted into a ground footprint, no actual heading is inferred and no row
geometry or availability is changed. This helps distinguish possible camera-view
occlusion from inaccurate calibration/reference placement through human review.

### Inspecting white ground inside a row

Python returns `background_regions`: the part of each row inside ROI not covered
by evaluated candidate polygons. It separates actual occupied reference geometry
(`OCCUPIED_REFERENCE`, with related detection IDs) from the remaining
`NOT_EVALUATED` ground. These are diagnostic categories, not availability states.
The active visible-shape mode evaluates partial-depth free ground directly. Legacy full-depth diagnostics can leave white ground behind a partial-depth vehicle; caps and projection failures can also leave unassessed regions. Missing evidence and output limits have their own reasons.
Regions exclude ROI holes and candidates; no availability counts are modified.

Click or keyboard-activate white ground on the new 2D map for an indigo selection
outline and **รายละเอียดพื้นที่สีขาว**. The normal candidate/family readout is
hidden for that selection. White regions now also carry projected image geometry,
the same mask/fallback overlap diagnostics, and separate `depth_blockers`: reference
vehicles whose lateral projection intersects that region over the row depth.
These blockers explain full-depth candidate exclusion; they do not automatically
mean image occlusion or actual ground overlap with the white patch. Blocker lists
are capped at 12 with an explicit truncation flag.

The shared inspector shows **ตรวจพื้นสีขาวบนภาพจริง** and includes both image
occluders and row-depth reference blockers, with source buttons for the context
crop. Background selection is controlled alongside gap selection so the full
photo overlay and crop follow the same selected region, including when returning
to a candidate. Closing it restores candidate inspection. The
browser selects server-classified geometry and does not perform point-based
availability inference. White ground outside rows is not covered by this tool.

### Yellow near-fit advisories

The Seg-only route may mark a visible narrow rectangular patch
`ALMOST_AVAILABLE` when extending its target to one side would provide the entered
width plus margin, requiring at most 0.10 m extra width and an occupied-overlap
ratio no greater than the shared experimental 10% threshold from
`almost_available_service`. The target must remain in row/ROI, conflict with
exactly one known detection and avoid localized uncertainty envelopes. All
unoccupied parts of the enlarged target must pass image-visibility checks too.
Uncertainty, missing evidence, invalid projections, hidden ground and large
conflicts never become yellow. This is an advisory width geometry result, not
proof of a feasible movement or manoeuvre. Vehicle length remains unchecked.

`near_fit` records the extra width, overlap ratio, responsible detection ID and
target polygons in both coordinate systems. `movement_status=NOT_COMPUTED` is
explicit: no destination, vehicle-moving path or permission to move a vehicle is
established. Extra width is not a promised physical displacement of the blocker.
`almost_count` is separate in overall, row and incoming summaries; yellow never
increments `green_count`/`recommended_count` or gets compatible-family suggestions.
The normal narrow interval stays displayed at its actual width, with a dashed
yellow target when selected and the caption **อาจจอดได้หากขยับรถข้างเคียง**.
These thresholds are experimental constants, not measured parking tolerances.

### Optional width-only preview

The map switch **ทดลอง: แสดงช่องกว้างพอเป็นสีเขียวลายเฉียง** is off by default.
When enabled, an UNKNOWN candidate whose Python-supplied `width_check` is
SUFFICIENT uses green diagonal hatching in both the image overlay and metric map.
The caption is **กว้างพอ · ยังไม่ยืนยันว่าจอดได้**. The original UNKNOWN state,
reasons, counts, family eligibility and incoming recommendations remain unchanged.
Narrow or unevaluated candidates do not receive the pattern. Switching off restores
normal fills without another Analyze request. JavaScript never compares widths.
This is an operator visualization, never a published availability override.

### Incoming vehicle width

The operator can enter **ความกว้างรถที่จะเข้าจอด** and press Analyze. The private
Analyze form accepts `incoming_width_m` (finite, greater than zero, at most 5 m)
and `clearance_margin_m` (finite, 0 through 1 m total across both sides),
and automatically includes segmentation/gap analysis. Invalid widths are rejected
before detection. Python reuses the same frame/geometry without another inference.

The full polygon patch is shown regardless of whether its witness width is below 1 m. For example a
0.82 m interval meets a 0.75 m target with a 0.05 m total margin if all evidence
checks pass; a 0.79 m interval does not. Row/ROI containment, occupancy and visibility
checks remain required. `incoming_vehicle` contains the entered width,
`allocation_width_m` (width plus margin), full patch geometry and capped counts.
Only WIDTH_SUFFICIENT intervals are suggested; uncertain intervals are counted but
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

Selecting a green interval shows catalogue families whose exact reference widths
plus the same margin fit that interval. Python reads `config/motorcycle_reference_sizes.json` on every
Analyze. Suggestions include reference width, remaining total lateral clearance
and provenance. Per-family length, access paths and manoeuvring are not checked;
the midpoint depth shown is not proof that the suggested full motorcycle fits.
Suggestions are individual choices, not simultaneous vehicle capacity. Invalid
rules retain geometry with a separate error; non-green slots have no suggestions.

The new map defaults to ROI bounds and ROI-clipped segmentation vehicle shapes.
Seg-only results show a fixed source label instead of a detector switch. Outside-ROI
and uncertainty-envelope switches are display-only and never change decisions.
SPU rows display 5 to 1; zoom, slot selection and status colours
are shared with the camera view. Blue marks selection without replacing status.
Red occupied shapes are reference vehicles, purple is row geometry, green/grey/red
intervals represent sufficient/unknown/narrow width, and neutral background has no availability claim. The list shows interval
width/depth and failure reasons; only the selected slot has a map distance label.

At most 200 candidates and 200 diagnostic intervals are returned. `truncated=true`
means additional results were omitted, not that the omitted area is occupied.
Legacy full-standard-footprint and midline-width helpers remain tested diagnostics;
the operator route uses VISIBLE_FREE_SHAPES. The legacy continuous/full-depth helpers remain available for regression diagnostics. Standard analysis, worker, persisted state
and LIFF are unchanged. Training stays terminal-only.

## Verification

Tests cover sub-metre intervals, one 6 m region, target plus clearance, row depths,
uncertainty diagnostics, occlusion, ROI gates, and legacy slots, deterministic IDs, limits, reference-width family
matching, invalid rules, stale calibration, wrong image resolution and legacy
fitting regressions. Seg-only tests verify invariance to primary-only vehicles
and classifier reference sizes; mask tests cover bbox-only false occlusion and
fallbacks. Local uncertainty tests cover all-heading envelope coverage, split
unknown/clear pieces, missing evidence and fail-closed unresolved uncertainty.

```powershell
cd tools/calibration-ui
node scripts/test-classifier-ui.mjs http://127.0.0.1:3000 ../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg yolo11n_cls --gaps
```
# Grey interval presentation

The width-only preview is enabled by default in Parking. UNKNOWN intervals with
a backend SUFFICIENT width check use green hatching, retaining UNKNOWN reasons,
counts and recommendation eligibility. The operator can turn the preview off.

The metric top-down view unions touching UNKNOWN candidate shapes within each
row for display, removing internal grey borders. It preserves holes, disconnected
regions and the optional width-preview treatment. Original candidates remain
selectable for their individual reasons and distances; counts, recommendations,
backend geometry and UNKNOWN status do not change.
