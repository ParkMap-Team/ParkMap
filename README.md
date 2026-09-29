# ParkMap

ParkMap is a frontend/backend monorepo for motorcycle parking monitoring.

```text
ParkMap/
├── frontend/  # Next.js dashboard and normalized SVG parking map
└── backend/   # FastAPI API and future Computer Vision pipeline
```

The frontend visualizes the backend parking-analysis pipeline. YOLO inference, ROI calibration, homography, dynamic physical rows, occupied geometry, free-space calculation, capacity witnesses, and parking-state diagnostics belong in the Python backend.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The dashboard can analyze an uploaded image through the backend and display the Physical Map and camera overlay.

## Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Endpoints:

- Health: <http://localhost:8000/api/health>
- Parking API: <http://localhost:8000/api/parking/status>
- Image analysis: `POST http://localhost:8000/api/detection/analyze` with multipart field `image`
- Metric calibration: `GET/POST http://localhost:8000/api/metric-calibration`
- API docs: <http://localhost:8000/docs>

Run the frontend and backend in separate terminals. Local CORS permits `http://localhost:3000`; additional origins can be configured through the backend environment.

The detection endpoint runs the configured YOLO model and returns normalized top-left motorcycle bounding boxes. Upload analysis then applies the active parking calibration, homography, physical row dimensions, occupied/free geometry, capacity, and parking-state validation.

## Setup workflow

The Setup page uses one reference image and two editing modes:

1. **Parking Area** — draw the Parking ROI and any number of rows (R1–Rn), then edit physical row dimensions in the collapsed dimensions panel.
2. **Ground Map Calibration** — edit the P1–Pn ground-control points and calculate/update the homography.

Switching modes changes the visible editor while keeping the same reference image. Row IDs are dynamic and may be sparse (for example `row_1`, `row_2`, `row_4`).

## Future Site Measurement Checklist

- Measure the usable physical length and width of every configured parking row separately.
- Measure useful Parking ROI boundary/reference segments and record their exact endpoints.
- Collect additional known, non-collinear ground points and surveyed coordinates if accurate 2D image-to-ground calibration is required.

Do not estimate missing values from pixels, motorcycles, painted lines, maps, or generic vehicle dimensions. These measurements will later connect normalized row position `t` to longitudinal position through `s = t × measured row length`; they do not by themselves establish complete 2D metric geometry.

## Estimated and measured metric values

- `ESTIMATED` values are temporary approximations entered manually for development and workflow testing. They are not verified site measurements.
- `MEASURED` values are values the user physically measured at the parking site.

Measured physical row dimensions are edited from Setup and saved with the ground-plane calibration. They are used with the validated homography to derive physical row geometry; they do not replace the ground-control points required for a 2D map.

## ParkMap Branding

Logo file:

`frontend/public/branding/parkmap-logo.png`

Absolute local path:

`C:\Users\user\Desktop\ParkMap Test\frontend\public\branding\parkmap-logo.png`

Use a PNG with a transparent background and keep the filename exactly `parkmap-logo.png`. Copy or replace that file to update the header logo, then refresh the page; restart or rebuild the frontend if the development or deployed build has cached the previous asset. If the file is missing or cannot load, the header safely keeps the existing ParkMap icon and text without showing a broken image.

For a future favicon or app icon, first create a dedicated square/cropped variant suited to small sizes. Do not use the full logo blindly when its aspect ratio or detail is unsuitable.
