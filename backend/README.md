# ParkMap Backend

FastAPI service for the ParkMap frontend. The upload analysis endpoint runs the custom ParkMap Ultralytics YOLO model. The parking-status endpoint still returns deterministic **TEST DATA** and does not infer free space, calculate homography, or contain calibrated parking rows.

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
