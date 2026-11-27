from fastapi.testclient import TestClient

from app.main import app


def test_retired_hybrid_analysis_returns_gone_without_running_inference(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Retired Hybrid must not read calibration or run inference")

    monkeypatch.setattr("app.main.cv_service.analyze_image", forbidden)
    monkeypatch.setattr("app.main.calibration_service.load", forbidden)
    response = TestClient(app).post("/api/hybrid-parking/analyze", files={"image": ("unused.png", b"unused", "image/png")})
    assert response.status_code == 410
    assert "retired" in response.json()["detail"].lower()
