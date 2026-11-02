# Local classifier reference-size experiment

Edit [`apps/vision-api/config/motorcycle_reference_sizes.json`](../apps/vision-api/config/motorcycle_reference_sizes.json)
in VS Code. All 46 exact class names come from the classifier catalog. Every class
starts at width **0.66 m** and length **2.00 m**, matching the standard footprint.
The width is the original lateral parking pitch, not a measured body/mirror width.
No manufacturer dimensions have been inferred for these defaults.

For example, find `wave`:

```json
"wave": {
  "width_m": 0.66,
  "length_m": 2.0,
  "basis": "INITIAL_STANDARD_NOT_MEASURED"
}
```

Replace width/length with your reference values **in metres**, and `basis` with the
source/version and whether mirrors are included. Keep class keys unchanged: `Wave`
and `wave` are not aliases. Families can contain different submodels/years, and
classification can be wrong. These remain experimental references, not individual
vehicle measurements, regardless of the basis text.

`fallback` supplies sizes for missing classes or unclassified detections.
`min_score` is a top-1 softmax cutoff, initially `0.0` so every configured top-1 class
can use its rule. Raising it makes lower scores use fallback; it is not calibrated
confidence or a trained unknown class. Each crop records its rule/fallback reason.
Dimensions must be positive finite numbers (width <=5 m, length <=10 m). Strings,
booleans, unknown fields and malformed files are rejected. Bad rules disable the
experiment with an error while keeping detection, classification and standard
parking analysis available.

Open **Parking**, choose a model/image, then **Analyze**. Both standard and
experimental parking results are returned. The **ใช้ขนาดอ้างอิงตามคลาส · ทดลอง**
switch selects the display without rerunning YOLO and starts enabled. The map
uses Python polygons joined by detection index; each crop shows its size/basis.
After editing JSON values, press Analyze again; no server restart is required.

Experimental occupied footprints retain the existing ground anchor and axis.
Width/length changes row overlap, occupied/free geometry and local capacity.
**Prospective incoming vehicles still use standard 0.66 x 2.00 m fitting.** This is
not yet a query asking which family can fit a gap. Wrong classes can yield wrong
footprints; local capacity/green results are not safe-parking guarantees.

Worker, persisted states and LIFF retain standard dimensions. These references
are never published to live state, and do not satisfy ADR 0011's locked-reference
validation requirement for replacing demo behavior.

Tests cover exact lookup/fallback, reload, invalid sizes, default geometry parity,
changed occupied/free area, detection identity, invalid-file recovery and the
unchanged standard/live footprint.
