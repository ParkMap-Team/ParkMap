# Local motorcycle annotation workspace

Status: accepted, 2026-11-01. Extends ADR 0013 and the detector evaluation protocol.

The operator UI has three areas: Parking, Setup, Label. Setup groups camera/metric
calibration and static lot authoring under separate tabs and save actions. Existing
`/lot-model` bookmarks open its Setup tab. Switching tabs retains mounted work so
unsaved labels and reference images are not discarded. Camera calibration remains
local-file based and lot models remain site-specific; grouping the UI does not
pretend that selecting a lot also selects that camera's calibration.

Label accepts JPEG/PNG/WebP, validates type/decoding/dimensions/size on the Python
boundary, normalizes EXIF orientation, and stores metadata-free PNG. Normalized
top-left boxes, manually confirmed wheel-ground points (or null when unobservable)
and occlusion flags are stored separately. YOLO supplies optional box proposals;
it never writes reviewed ground truth, infers a confirmed ground point or certifies
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
One capture session cannot cross splits. Each export is a new immutable directory
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
