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
