# Local lot model editor

Status: accepted, 2026-10-30.

The operator draws static surroundings in `tools/calibration-ui/lot-model`: metric
positions, rectangular dimensions and rotations, arbitrary polygon vertices, tree
heights and canopy radii. The starting definition is the existing
`apps/vision-api/fixtures/spu-cam-01-lot-model.json`, read by the API without rewriting
the fixture. A saved draft takes precedence on later visits. Irregular shapes,
holes, provenance and building facade metadata are preserved. The 3D preview uses
static primitives; it is not a camera reconstruction or an availability display.

Drafts live in a separate Postgres table, one per site. Saving does not affect the
active lot model. Explicit activation validates the stored draft again and creates
a normal lot-model version. LIFF continues to consume its existing public endpoint
and renderers. Draft revision and base active-version checks reject stale writes
with 409, and site-row locks serialize activation with the existing CLI. Deleting
a site also deletes its draft. An explicit ROI edit mode allows moving whole metric
parking-area polygons, rotating all rings around the outer bounds centre, resizing
rectangles, and editing individual corners. For a site with exactly one ROI, an
explicit **Use this ROI as lot outline** action copies every ring to the outline,
without moving landmarks. The SPU fixture starts with identical outline and ROI;
this action lets the operator keep that relationship after rotating or moving it.
No surrounding ground is automatically inferred or added. Other outline edits stay
locked. The API
rejects invalid, overlapping, out-of-outline or foreign-site parking areas.

Camera-ground and lot coordinates are separate frames. On public state reads, Python
matches the ordered ROI vertices from the active calibration's stored
`ground_plane_homography.json/roi_metric/points` to the active lot polygon. One rigid
rotation and translation must match every vertex within 0.000001 m; scale, reflection,
changed corners and incompatible rings fail closed. The transform moves every region
ring, motorcycle centre and heading together, preserving motorcycle dimensions,
timestamps, freshness and availability decisions. Stored worker observations remain
in camera-ground coordinates, so repeated polls never accumulate a transform. LIFF
continues to render its existing contract. Legacy synthetic fixtures without a camera
homography retain their existing coordinates.

Activating a rigid placement keeps calibration active. Resizing, reshaping, removing
an area or lacking a compatible stored calibration deactivates calibration in the
activation transaction. Draft changes and landmark-only activation do not do this.
Re-registering an incompatible calibration does not bypass the read check: public
state returns CALIBRATION_MISMATCH without geometry. Stale or unavailable evidence
is never restored by placement. Image-space calibration and worker fitting inputs
remain unchanged; geometry changes require calibration review. Registration and lot
activation share the site lock. No availability, calibration or detection decisions
move into the browser.

This is a local operator tool. Authoring endpoints require a separate
`PARKMAP_EDITOR_TOKEN`; without it they return 503. `start-dev.bat` creates an
ephemeral token shared by the local API and UI server processes, without printing
or persisting it. A same-origin UI server proxy supplies the token; browser code,
browser storage and public LIFF never receive it. The UI dev server binds to IPv4
loopback, the proxy rejects non-loopback hosts and cross-origin writes, and JSON
imports are bounded to 1 MB. Vite's development middleware keeps the token in its
Node server process rather than putting it in workerd bindings or browser bundles;
the built route-handler fallback always fails closed, even if deployment secrets
are configured. It does not offer a public credential proxy.
Manual startup needs the same private token on both
servers. A network-accessible operator app would require a separate authentication
decision; this change does not turn the calibration POC into a public admin app.

Rejected: editing the student-facing LIFF renderer, storing client-only width and
length fields in the API geometry, or activating on every save. They either put
authoring in the student flow, break the existing schema, or expose unfinished
geometry. The cost is a small draft migration and an explicit save/activate step.
