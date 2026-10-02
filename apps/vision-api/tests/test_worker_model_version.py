from datetime import UTC, datetime
from types import SimpleNamespace

import numpy as np

from app.worker import __main__ as worker
from app.worker.frames import Frame


def test_worker_publishes_the_fingerprinted_analysis_version(monkeypatch):
    analysis = {
        "analysis_version": "parking-analysis-v2",
        "camera_id": "camera-1",
        "physical_map": {"rows": []},
    }
    monkeypatch.setattr(worker, "calibration_version", lambda _: "calibration-v1")
    monkeypatch.setattr(
        worker,
        "cv_service",
        SimpleNamespace(
            analyze_image=lambda _: object(),
            published_analysis_version=lambda revision: (
                f"{revision}+model-1234567890abcdef"
            ),
        ),
    )
    monkeypatch.setattr(
        worker, "parking_analysis_service", SimpleNamespace(analyze=lambda _: analysis)
    )
    frame = Frame(
        image=np.zeros((1, 1, 3), dtype=np.uint8),
        captured_at=datetime(2026, 10, 1, 8, 0, tzinfo=UTC),
    )

    state = worker.analyze_frame(
        frame, parking_area_id="area-1", source="RECORDED_REPLAY"
    )

    assert state.analysis_version == "parking-analysis-v2+model-1234567890abcdef"
