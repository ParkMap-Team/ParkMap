# Local motorcycle annotation workspace

Status: accepted, 2026-11-01. Extends ADR 0013 and the detector evaluation protocol.

The local segmentation gap overlay now checks only the standard lateral width
(0.66 m). Green means `WIDTH_SUFFICIENT`, not full-vehicle fitting or availability.
Target length is not an acceptance criterion; row geometry, calibration,
uncertainty and image occlusion checks remain required. This does not change
standard parking analysis, worker publication or LIFF semantics.

The operator UI has three areas: Parking, Setup, Label. Setup groups camera/metric
calibration and static lot authoring under separate tabs and save actions. Existing
`/lot-model` bookmarks open its Setup tab. Switching tabs retains mounted work so
unsaved labels and reference images are not discarded. Camera calibration remains
local-file based and lot models remain site-specific; grouping the UI does not
pretend that selecting a lot also selects that camera's calibration.

Label accepts JPEG/PNG/WebP, validates type/decoding/dimensions/size on the Python
boundary, normalizes EXIF orientation, and stores metadata-free PNG. Normalized
top-left boxes and occlusion flags are edited in the UI. The manual ground-point
tool and markers have been removed for the current box-training workflow; optional
ground-point metadata remains in the API solely for compatibility with saved work.
Existing points are preserved but are not displayed or edited. YOLO supplies
optional box proposals; it never writes reviewed ground truth or certifies
occlusion. A human must review the entire image, including detector misses and
negative images. Any UI geometry/metadata edit clears review confirmation.

Authoring routes use the server-only operator key and the same loopback/same-origin
Vite proxy boundary as ADR 0013. Built/public UI routes fail closed. Python owns
image validation and export. Dataset IDs and image IDs are validated identifiers,
never browser-supplied filesystem paths. Workspace storage defaults to the ignored
`tools/yolo-training/datasets/<dataset>/`; `PARKMAP_DATASET_ROOT` is a server-only
override for private storage and tests. SQLite transactions serialize saves,
revision checks reject stale tabs, and repeated canonical images reuse their ID.

Export requires all images reviewed and explicitly assigned to train/val/test.
Capture groups are derived server-side from the stored original filename's calendar
date; the UI no longer requires manual capture-session entry. All images on one
day form one conservative group, not one group per timestamp. Invalid or absent
dates share a single undated group. Grouping is recalculated when reading older
annotations without changing their boxes/review status. Export also checks grouping
so older assignments cannot bypass the rule. A real session spanning midnight must
still be assigned to the same split by the operator; a filename is not independent
evidence of a recording session. Each export is a new immutable directory
containing split image/YOLO label pairs, sessions.json and extra JSON annotations.
YOLO receives only class-0 boxes. Ground points and occlusion support separate
evaluation; they are not added to YOLO txt. Exports may be partial, but readiness
indicates whether all three splits are non-empty; training validation rejects
incomplete data. There is no automatic random split.

Training runs only by an explicit Python command in VS Code Terminal. It validates
sessions, labels, image orientation and exact-file leakage first, writes unique
ignored runs and never replaces API weights. Test evaluation is opt-in and is not
used for checkpoint selection. No web training process, queue, public image store,
or new LIFF behavior is introduced. The existing Label Studio workflow can still
be used; the local workspace is an additional team-owned labelling option. The
footage policy applies equally to local workspace images, SQLite and exports.

Parking also has a local classifier experiment panel, driven by the main Analyze
button alongside detection. Python runs YOLO once and reuses those boxes for
native crops and classification, including each analyzed video frame. Parking
and classifier failures are reported separately so successful detections remain
visible. It uses the same
operator-only loopback proxy, discovers completed local ResNet18, EfficientNet-B0
or YOLO11n-cls runs, and loads
their hash-verified `best.pt` with `weights_only=True`. Python owns EXIF handling,
YOLO boxes, native-resolution crops, aspect-preserving padding, and top-three
family scores. The standalone operator predict API retains a pre-cropped
single-motorcycle mode that bypasses YOLO. Uploads and
previews stay in request/page memory, use no-store responses, and are never
automatically added to Label or a dataset. Changing input/model/mode clears old
results. This is closed-set classification with uncalibrated scores, not verified
model identity, measured dimensions, or parking availability. Neither LIFF nor
the worker's parking geometry uses these experimental predictions. Training remains terminal-only.

Local Parking may map exact classifier families through
`config/motorcycle_reference_sizes.json`. All classes initially use the standard
0.66 m lateral pitch and 2.00 m length, explicitly not measured vehicle dimensions.
Python returns separate experimental occupied/free geometry and capacity for UI
comparison with the unchanged standard result. Prospective incoming vehicles keep
standard fitting dimensions. Invalid rules retain standard analysis with an error.
Worker, persisted state and LIFF never consume these references. This experiment
does not replace ADR 0011's validation requirement. See
[reference-size instructions](../motorcycle-reference-sizes.md).

Parking also supports an explicitly enabled YOLO11m-seg comparison. A separate
local model returns normalized image masks, counts and timings while the original
detector, classifier crops and parking analysis remain authoritative for that
flow. Masks are never treated as metric ground footprints or persisted/published
to worker/LIFF. Failures preserve standard analysis. No weights are downloaded
by request handlers. See the [segmentation comparison](../segmentation-experiment.md).

Local segmentation gap/clearance analysis is a further explicit experiment. It
uses the conservative union of both detectors with calibrated reference
footprints and the standard incoming target, retaining larger known references.
Green means a model width-sufficient corridor, not full fitting or live availability. Image masks
and boxes gate potential occlusion instead of being projected as ground shapes.
Missing evidence/calibration and uncertainty withhold green. Results have a
separate response/overlay and never publish to worker/LIFF. See
[gap semantics and limitations](../segmentation-gaps.md).

The experiment has its own metric top-down view alongside the image overlay,
using Python-provided geometry and identical uncertainty states. It is an
additional display; the existing Physical Map is retained. It does not project
vehicle masks as ground shapes or calculate fitting in JavaScript.
The view defaults to ROI bounds and ROI-clipped segmentation footprints, with
optional outside-ROI and detector layers. Width checks now measure a 2 cm band
centred on each row midline, rather than demanding a full-row-depth corridor.
Image occlusion and row uncertainty continue to withhold green; width sufficiency
at this cross-section is not a claim that a full motorcycle can fit.
