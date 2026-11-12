# Uniform ROI scaling is map presentation

Accepted 2026-11-13. Supersedes ADR 0013's uniform-scale rejection only.

The operator wants to resize the same ordered ROI shape on the lot map without
changing camera calibration, row distances, motorcycle references or gap fitting.
Rewriting calibration dimensions would change physical analysis, so we instead
prove one positive uniform scale plus rotation and translation between the
calibration ROI and the active lot ROI. Every corresponding vertex and hole must
match; non-uniform stretching, changed corners and reflection still fail closed.

Python applies this display transform when reading public state. Original stored
worker observations, width_m, length_m, width references, timestamps, uncertainty
and availability semantics stay unchanged. Proxy centres/headings and region
coordinates move into the map frame; display_scale explicitly sizes the symbol
and fallback footprint in both renderers. Symbol fitting remains display-only.
Repeated reads always start from stored camera-ground observations.

This lets activation retain calibration for a proven display resize. Actual
camera movement, a changed image ROI or altered physical measurements still
require camera calibration review. There is no automatic reactivation of old
calibration after arbitrary geometry edits. The existing local calibration was
explicitly re-registered after checking the active ROI is uniformly related.

Map coordinates after display scaling are layout coordinates, not a new survey.
Numeric analysis widths remain in physical metres and must not be measured from
pixels or interpreted using the scaled map grid. Selecting a clipped width
preview continues to identify its original analysis interval.
