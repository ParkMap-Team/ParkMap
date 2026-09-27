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
- API docs: <http://localhost:8000/docs>

Run the frontend and backend in separate terminals. Local CORS permits `http://localhost:3000`; additional origins can be configured through the backend environment.
