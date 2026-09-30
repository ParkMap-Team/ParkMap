from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app, cv_service, parking_analysis_service
from app.models import Detection, DetectionAnalysisModel, DetectionBBox, DetectionInference, DetectionResponse


def test_analyze_endpoint_includes_backend_parking_analysis(monkeypatch):
    image = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")
    detection = DetectionResponse(
        image_width=2,
        image_height=2,
        model=DetectionAnalysisModel(name="ParkMap YOLO", status="ready"),
        inference=DetectionInference(imgsz=960, confidence_threshold=0.25, nms_iou=0.5, processing_time_ms=1.0),
        detections=[Detection(class_id=0, class_name="motorcycle", confidence=0.9, bbox=DetectionBBox(x=0.1, y=0.1, width=0.2, height=0.2))],
    )
    expected_analysis = {"analysis_version": "parking-analysis-v1", "detection_summary": {"detected": 1}}
    monkeypatch.setattr(cv_service, "analyze_image", lambda image_bytes: detection)
    monkeypatch.setattr(parking_analysis_service, "analyze", lambda result: expected_analysis)

    response = TestClient(app).post("/api/detection/analyze", files={"image": ("frame.png", image.getvalue(), "image/png")})

    assert response.status_code == 200
    payload = response.json()
    assert payload["detections"]
    assert payload["parking_analysis"] == expected_analysis


def test_health_works_without_model_and_detection_reports_unavailable(monkeypatch, tmp_path):
    image = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")
    monkeypatch.setattr(cv_service, "model_path", tmp_path / "missing.pt")
    monkeypatch.setattr(cv_service, "_model", None)

    client = TestClient(app)
    assert client.get("/api/health").status_code == 200
    response = client.post("/api/detection/analyze", files={"image": ("frame.png", image.getvalue(), "image/png")})

    assert response.status_code == 503
    assert response.json()["detail"] == "The detection model is unavailable."


def test_analyze_rejects_mismatched_image_type():
    image = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")

    response = TestClient(app).post("/api/detection/analyze", files={"image": ("frame.jpg", image.getvalue(), "image/jpeg")})

    assert response.status_code == 400


def test_analyze_rejects_image_above_pixel_limit(monkeypatch):
    image = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")
    monkeypatch.setattr("app.main.MAX_IMAGE_PIXELS", 3)

    response = TestClient(app).post("/api/detection/analyze", files={"image": ("frame.png", image.getvalue(), "image/png")})

    assert response.status_code == 413


def test_analyze_reports_missing_parking_configuration(monkeypatch, tmp_path):
    image = BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")
    detection = DetectionResponse(
        image_width=2,
        image_height=2,
        model=DetectionAnalysisModel(name="ParkMap YOLO", status="ready"),
        inference=DetectionInference(imgsz=960, confidence_threshold=0.25, nms_iou=0.5, processing_time_ms=1.0),
        detections=[],
    )
    monkeypatch.setattr(cv_service, "analyze_image", lambda image_bytes: detection)
    monkeypatch.setattr(parking_analysis_service, "root", tmp_path)

    response = TestClient(app).post("/api/detection/analyze", files={"image": ("frame.png", image.getvalue(), "image/png")})

    assert response.status_code == 503
    assert response.json()["detail"] == "Parking analysis calibration is unavailable."
