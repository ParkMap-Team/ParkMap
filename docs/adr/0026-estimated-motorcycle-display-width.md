# Estimated bbox width for LIFF motorcycle display

Accepted 2026-11-20 at the owner's request. Amends ADR 0011's uniform proxy
display dimensions; standard occupancy and fitting dimensions stay unchanged.

Python ports the old `motorcycleSizeExperiment.ts` calculation: at the bbox's
bottom centre, project points 16 pixels to the left and right through the current
ground homography. Their metric distance divided by 32 is the local metres per
pixel. Multiply by the bbox's pixel width to obtain an approximate image span.
This is an apparent bbox width, not a measured motorcycle body or mirror width;
perspective, vehicle heading, height, occlusion and detector boxes affect it.

The worker publishes optional `MotorcycleProxy.estimated_width_m`. Only a current,
validated homography with current row measurements and matching frame resolution
may supply it. Non-finite, non-positive, above-3-metre, singular or out-of-frame
estimates fall back to null. Missing/invalid calibration for this display estimate
never interrupts standard publication; the existing calibration identity check
still rejects a calibration change during frame analysis.

LIFF's shared 2D/3D map model applies `display_scale` once to this field for the
motorcycle drawing. It keeps the existing displayed centre, heading and length,
and does not squeeze the estimated width back into the standard occupied band.
Older states and null estimates keep the existing standard symbol fitting.

For worker publication and LIFF, `width_m`, `length_m`, occupied regions,
hit-test footprints, uncertainty, holds, recommendations and free-ground
calculations do not consume this field. It must
not promote a width preview to `AVAILABLE` or establish that occluded ground is
empty. Replacing fitting dimensions still requires locked-reference validation.

The contract is generated from Python OpenAPI into both TypeScript consumers.
The operator Calibration image analyzer returns the same display proxies in
`ParkingClassifierResult.motorcycles`, using the shared Python proxy builder
and width estimator. At the owner's subsequent request, the operator's primary
Seg analysis opts into `use_segmentation_widths`: reference widths use the same
Python estimate, falling back to standard width. Red row bands and gap candidates
are recomputed together from those references; the separate dark overlay is
removed. Bands still extend through row depth, not the visible vehicle height.
Incoming vehicle requirements, occlusion and uncertainty gates remain unchanged.
This is an operator experiment, not measured geometry or proof of availability.
Worker publication keeps standard occupancy widths unless separately opted in.
Reference points and the stored homography remain unchanged.
Changing the image clears the display metadata; each analysis replaces it.
`SegmentationGapResult.estimated_widths_m` carries estimates keyed by original
detection ID from the same validated calibration snapshot used for the red
bands. The operator response and inspector reuse these values, including for
unassigned detections, instead of rereading calibration files. A calibration
change during gap analysis rejects both geometry and width estimates together.
Checks cover local perspective scale, malformed/stale/mismatched calibration,
publication identity and unchanged occupancy, transport bounds, fallback and
single display scaling. Physical accuracy against annotated vehicles remains
unverified.
