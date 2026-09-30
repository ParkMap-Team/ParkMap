from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from pytest import approx

from app.main import app, cv_service
from app.models import Detection, DetectionAnalysisModel, DetectionBBox, DetectionInference, DetectionResponse
from app.services.auto_parking_service import (
    AutoDetection,
    aggregate_detections,
    analyze_detections,
    detections_from_response,
    estimate_parking_region,
    estimate_rows,
    infer_rows,
)


def _response(points: list[tuple[float, float]]) -> DetectionResponse:
    return DetectionResponse(
        image_width=100,
        image_height=100,
        model=DetectionAnalysisModel(name="ParkMap YOLO", status="ready"),
        inference=DetectionInference(imgsz=960, confidence_threshold=0.25, nms_iou=0.5, processing_time_ms=1),
        detections=[Detection(class_id=0, class_name="motorcycle", confidence=0.8, bbox=DetectionBBox(x=x, y=y, width=0.04, height=0.06)) for x, y in points],
    )


def test_bottom_center_and_normalized_aggregation():
    items = detections_from_response(_response([(0.1, 0.2)]), 0, "a.png")
    assert items[0].as_dict()["bottom_center"]["x"] == approx(0.12)
    assert items[0].as_dict()["bottom_center"]["y"] == approx(0.26)
    assert aggregate_detections(items)["detections_per_image"] == [1]


def test_empty_input_is_unknown_and_has_no_rows():
    result = analyze_detections([("empty.png", _response([]))])
    assert result["status"] == "INSUFFICIENT_EVIDENCE"
    assert result["rows"] == []
    assert result["parking_regions"][0]["status"] == "INSUFFICIENT_EVIDENCE"


def test_dynamic_deterministic_rows_and_region():
    responses = [("a.png", _response([(0.1, 0.2), (0.5, 0.2), (0.9, 0.2), (0.2, 0.6), (0.8, 0.6)])), ("b.png", _response([(0.3, 0.21), (0.7, 0.61)]))]
    result = analyze_detections(responses)
    assert [row["row_id"] for row in result["rows"]] == ["row_1", "row_2"]
    assert result["parking_regions"][0]["status"] == "ESTIMATED"
    assert all(0 <= point["x"] <= 1 and 0 <= point["y"] <= 1 for point in result["parking_regions"][0]["polygon"])


def test_api_rejects_zero_images():
    assert TestClient(app).post("/api/auto-parking/analyze").status_code == 422


def test_api_rejects_invalid_image():
    response = TestClient(app).post("/api/auto-parking/analyze", files={"images": ("bad.png", b"not-an-image", "image/png")})
    assert response.status_code == 400


def test_api_does_not_require_calibration(monkeypatch):
    image = BytesIO()
    Image.new("RGB", (100, 100), "white").save(image, format="PNG")
    monkeypatch.setattr(cv_service, "analyze_image", lambda image_bytes: _response([(0.1, 0.2), (0.5, 0.2), (0.9, 0.2)]))
    files = [
        ("images", ("a.png", image.getvalue(), "image/png")),
        ("images", ("b.png", image.getvalue(), "image/png")),
    ]
    response = TestClient(app).post("/api/auto-parking/analyze", files=files)
    assert response.status_code == 200
    assert response.json()["analysis_mode"] == "AUTO"


def test_auto_row_order_is_deterministic():
    items = [AutoDetection(0, "a", 0.8, 0.8, 0.1, 0.9, 0.2), AutoDetection(0, "a", 0.8, 0.1, 0.5, 0.2, 0.6), AutoDetection(1, "b", 0.8, 0.4, 0.1, 0.5, 0.2), AutoDetection(1, "b", 0.8, 0.4, 0.5, 0.5, 0.6)]
    assert [row["row_id"] for row in estimate_rows(items)] == ["row_1", "row_2"]
    assert estimate_parking_region(items)["status"] == "ESTIMATED"


def test_perspective_scale_keeps_row_band_narrow():
    items = [
        AutoDetection(0, "a", 0.8, 0.1, 0.1, 0.16, 0.16),
        AutoDetection(1, "b", 0.8, 0.4, 0.12, 0.46, 0.18),
        AutoDetection(2, "c", 0.8, 0.75, 0.15, 0.83, 0.23),
    ]
    row = infer_rows(items)[0][0]
    ys = [point["y"] for point in row["polygon"]]
    assert max(ys) - min(ys) < 0.2
    assert row["local_scale"] == approx(0.06)


def test_sparse_observation_is_rejected_as_noise():
    items = [AutoDetection(0, "a", 0.8, 0.1, 0.1, 0.2, 0.2), AutoDetection(1, "b", 0.8, 0.4, 0.4, 0.5, 0.5)]
    rows, rejected = infer_rows(items)
    assert rows == []
    assert len(rejected) == 2


def test_nearby_rows_remain_separate_and_count_is_dynamic():
    items = [
        AutoDetection(0, "a", 0.8, 0.1, 0.1, 0.15, 0.15),
        AutoDetection(1, "b", 0.8, 0.4, 0.105, 0.45, 0.155),
        AutoDetection(2, "c", 0.8, 0.7, 0.1, 0.75, 0.15),
        AutoDetection(0, "a", 0.8, 0.1, 0.22, 0.15, 0.27),
        AutoDetection(1, "b", 0.8, 0.4, 0.225, 0.45, 0.275),
        AutoDetection(2, "c", 0.8, 0.7, 0.22, 0.75, 0.27),
    ]
    rows, _ = infer_rows(items)
    assert len(rows) == 2
    assert [row["row_id"] for row in rows] == ["row_1", "row_2"]
