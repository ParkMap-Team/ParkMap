# ParkMap

ParkMap is a frontend/backend monorepo for motorcycle parking monitoring.

```text
ParkMap/
├── frontend/  # Next.js dashboard and normalized SVG parking map
└── backend/   # FastAPI API and future Computer Vision pipeline
```

The frontend visualizes processed parking data. YOLO inference, ROI calibration, homography, calibrated rows, occupied intervals, and free-space calculation belong in the Python backend. The current backend returns deterministic test data only.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. Select Live mode to request `GET http://localhost:8000/api/parking/status`.

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

The detection endpoint runs the configured YOLO model and returns normalized top-left motorcycle bounding boxes. Physical metric calibration remains separate and unconfigured until real site measurements are supplied.

## Future Site Measurement Checklist

- Measure the usable physical length of Parking Rows 1 through 5 separately.
- Measure useful Parking ROI boundary/reference segments and record their exact endpoints.
- Collect additional known, non-collinear ground points and surveyed coordinates if accurate 2D image-to-ground calibration is required.

Do not estimate missing values from pixels, motorcycles, painted lines, maps, or generic vehicle dimensions. These measurements will later connect normalized row position `t` to longitudinal position through `s = t × measured row length`; they do not by themselves establish complete 2D metric geometry.

## Estimated and measured metric values

- `ESTIMATED` values are temporary approximations entered manually for development and workflow testing. They are not verified site measurements.
- `MEASURED` values are values the user physically measured at the parking site.

The source is selected explicitly in the Metric Calibration UI and is preserved when saved. Completing all five estimated row lengths does not create a ground-plane calibration, homography, or meters-per-pixel scale. When real measurements are available, replace the values in the same UI and explicitly select **Measured on site** before saving.

## ParkMap Branding

Logo file:

`frontend/public/branding/parkmap-logo.png`

Absolute local path:

`C:\Users\user\Desktop\ParkMap Test\frontend\public\branding\parkmap-logo.png`

Use a PNG with a transparent background and keep the filename exactly `parkmap-logo.png`. Copy or replace that file to update the header logo, then refresh the page; restart or rebuild the frontend if the development or deployed build has cached the previous asset. If the file is missing or cannot load, the header safely keeps the existing ParkMap icon and text without showing a broken image.

For a future favicon or app icon, first create a dedicated square/cropped variant suited to small sizes. Do not use the full logo blindly when its aspect ratio or detail is unsuitable.
