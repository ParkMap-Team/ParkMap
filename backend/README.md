# ParkMap Backend

Minimal FastAPI service for the ParkMap frontend. The parking endpoint currently returns deterministic **TEST DATA**. It does not run YOLO, infer free space, calculate homography, or contain calibrated parking rows.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Use `PARKMAP_ALLOWED_ORIGINS` as a comma-separated list for additional frontend origins.

Future model weights belong in `models/`. ROI, homography, and row calibration files belong in `config/`. Site-specific values are intentionally not fabricated here.

## Detection stub

`POST /api/detection/analyze` accepts a JPEG, PNG, or WebP as multipart field `image` and returns deterministic stub motorcycle detections. Bounding boxes use normalized top-left coordinates (`x=left`, `y=top`). The endpoint validates file type, size, image decoding, and real dimensions.

Copy future YOLO weights to `models/best.pt`. Until YOLO is integrated, the API and dashboard identify these results as `DETECTION STUB`.
