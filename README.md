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
