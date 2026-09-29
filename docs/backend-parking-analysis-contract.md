# Backend Parking Analysis Contract

FastAPI will be the authoritative owner of runtime parking analysis. The frontend uploads an image and renders the returned metric geometry and diagnostics; it must not rebuild occupied, free, fitting, capacity, or parking-state results.

## Required now

- `analysis_version`, `camera_id`, and source-image width/height
- detection summary: detected, metric-projected, included, and excluded counts
- renderable detections with metric ground points and canonical footprint polygons
- metric parking ROI and physical R1–R5 polygons with measured dimensions and area
- occupied Polygon/MultiPolygon per row, including area, percentage, and blocking detection IDs
- free Polygon/MultiPolygon per row, including area, percentage, component count, hole count, and validation status

Geometry uses metric `{x_m, y_m}` points. A polygon is an array of rings; ring zero is the exterior and subsequent rings are holes. A multipolygon is an array of polygons. Disconnected components remain separate polygons.

## Optional / future

- virtual-fitting diagnostics and optional placement polygons
- capacity results
- parking-state results
- additional trace and timing diagnostics

These optional fields do not define capacity or parking-state semantics in the frontend.

## Illustrative JSON

The values below demonstrate serialization only; they are not production configuration.

```json
{
  "analysis_version": "parking-analysis-v1",
  "camera_id": "EXAMPLE_CAMERA",
  "image": { "width": 1920, "height": 1080 },
  "detection_summary": { "detected": 3, "metric_projected": 2, "parking_included": 1, "parking_excluded": 2 },
  "detections": [],
  "physical_map": {
    "parking_roi": [{ "x_m": 0, "y_m": 0 }, { "x_m": 10, "y_m": 0 }, { "x_m": 10, "y_m": 5 }],
    "rows": [{ "row_id": "row_1", "polygon": [], "measured_length_m": 10, "measured_width_m": 2, "area_m2": 20 }]
  },
  "occupied_space": { "rows": [{ "row_id": "row_1", "occupied_geometry": { "polygons": [[[{ "x_m": 2, "y_m": 0 }, { "x_m": 3, "y_m": 0 }, { "x_m": 3, "y_m": 2 }]]] }, "occupied_union_area_m2": 1.5, "occupied_percent": 7.5 }] },
  "free_space": { "rows": [{ "row_id": "row_1", "free_geometry": { "polygons": [[[{ "x_m": 0, "y_m": 0 }, { "x_m": 10, "y_m": 0 }, { "x_m": 10, "y_m": 2 }], [{ "x_m": 2, "y_m": 0.5 }, { "x_m": 3, "y_m": 0.5 }, { "x_m": 3, "y_m": 1.5 }]]] }, "free_area_m2": 18.5, "free_percent": 92.5, "free_component_count": 1, "hole_count": 1, "validation_status": "VALID" }] },
  "fitting": null,
  "capacity": null,
  "parking_state": null
}
```

## Canonical semantics

Backend Parking Analysis V1 inclusion is authoritative when the metric point is
valid and at least one of these holds: the ground point is inside the metric
ROI; canonical footprint/ROI intersection area is greater than `1e-8`; or the
best physical-row overlap is at least `0.60` with a best-vs-second margin of at
least `0.20`. Geometry validity and occupied/free area balance are also
authoritative invariants.

## Historical reference only

**NOT PRODUCTION CONFIGURATION — REGRESSION REFERENCE ONLY**

**UNVERIFIED HISTORICAL OBSERVATION — NOT AN ACCEPTANCE CRITERION**

Image `20260925_1521.png`: YOLO 86, metric projected 86, parking included 28, rendered 28.

The 28/58 counts and historical occupied/topology values below are retained for
forensic comparison only. No raw runtime artifact proves how they were
generated; they must not be used to tune or reject canonical production
semantics.

- R1: row 30.00 m², occupied 10.35 m², free 19.65 m², components 1, holes 1
- R2: row 30.00 m², occupied 6.05 m², free 23.95 m², components 1, holes 1
- R3: row 30.00 m², occupied 6.05 m², free 23.95 m², components 1, holes 0
- R4: row 36.00 m², occupied 0.00 m², free 36.00 m², components 1, holes 0
- R5: row 36.00 m², occupied 16.20 m², free 19.80 m², components 3, holes 0

Frontend Virtual Fitting V1 is **not verified**. Its pre-fix run produced 4,470 samples and zero FIT results; this is not an expected future result.
