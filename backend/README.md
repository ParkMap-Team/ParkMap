# ParkMap Backend

FastAPI service for the ParkMap frontend. The upload analysis endpoint runs the custom ParkMap Ultralytics YOLO model and, when calibration is ready, returns the dynamic parking-analysis pipeline.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Use `PARKMAP_ALLOWED_ORIGINS` as a comma-separated list for additional frontend origins.

Model weights belong at `models/best.pt` by default. ROI, homography, and row calibration files belong in `config/`. Site-specific values are intentionally not fabricated here.

## YOLO detection

`POST /api/detection/analyze` accepts a JPEG, PNG, or WebP as multipart field `image` and returns real class-0 motorcycle detections. Bounding boxes use normalized top-left coordinates (`x=left`, `y=top`). The endpoint validates file type, size, image decoding, and real dimensions.

The model is loaded once when the application starts and is reused for each upload. Configure its path, input size, confidence, NMS IoU, and device with the `PARKMAP_MODEL_*` values shown in `.env.example`. Model initialization fails clearly instead of falling back to fake detections.

## Parking calibration

`GET /api/calibration` returns the saved schema-v2 calibration or `404` when calibration has not been configured. `POST /api/calibration` validates and atomically saves a normalized parking ROI plus a dynamic collection of manually drawn parking rows to `config/parking_calibration.json`.

Legacy `config/parking_roi.json` pixel coordinates are not loaded as normalized coordinates. Calibration defines the geometry consumed by the upload parking-analysis endpoint; it does not itself run inference.

## Metric calibration

`GET /api/metric-calibration` returns `NOT_CALIBRATED` when no physical measurements have been saved. `POST /api/metric-calibration` validates and atomically stores dynamic row dimensions and ground-control data in the separate ignored file `config/metric_calibration.json`. Every measured row ID must currently exist in Parking Calibration; sparse dynamic IDs are supported. Dimensions use meters internally and are treated as measured site values by the current Setup workflow.

### Future Site Measurement Checklist

- Measure the real usable length and width of every configured row.
- Record useful Parking ROI boundary distances as identifiable reference segments.
- Photograph or mark the exact endpoints used for every measured segment.
- For accurate future 2D ground-plane calibration, collect additional non-collinear ground-control points with normalized image locations and surveyed ground coordinates.

The intended future pipeline is: fixed camera → YOLO detection → Parking ROI → row assignment → row projection (`t`) → metric calibration → physical occupancy footprint → occupied intervals → candidate gaps → virtual motorcycle fitting → availability states. Motorcycles inside the ROI that are currently `UNASSIGNED` must remain available to future obstruction and bad-parking analysis.
