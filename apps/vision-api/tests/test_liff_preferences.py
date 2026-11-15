import time

import pytest
from fastapi.testclient import TestClient

from app.line_bot import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("LINE_LOGIN_CHANNEL_ID", "2011859796")
    with TestClient(app) as client:
        yield client


def test_preferences_require_verified_identity(client, no_database):
    assert client.get("/api/line/preferences").status_code == 401
    assert client.post("/api/line/webhook", json={}).status_code == 404


@pytest.mark.parametrize("model", ["click", "aerox", "nmax", "scoopy", "wave", "pcx", "fino", "forza", "grand_filano", "hd_road_glide", "cbr650r", "xmax", "other"])
def test_verified_account_saves_and_reads_model(database, client, monkeypatch, model):
    import requests
    class Response:
        status_code = 200
        def json(self):
            return {"iss": "https://access.line.me", "aud": "2011859796",
                    "sub": "U" + "1" * 32, "exp": int(time.time()) + 600}
    monkeypatch.setattr(requests, "post", lambda *a, **kw: Response())
    headers = {"Authorization": "Bearer synthetic-id-token"}
    assert client.get("/api/line/preferences", headers=headers).json()["model_id"] is None
    assert client.put("/api/line/preferences", headers=headers, json={"model_id": model}).status_code == 200
    assert client.get("/api/line/preferences", headers=headers).json()["model_id"] == model
    assert client.put("/api/line/preferences", headers=headers, json={"model_id": "invalid"}).status_code == 422


@pytest.mark.parametrize("claims", [{}, {"aud": "wrong"}, {"exp": 0}, {"sub": "bad"}])
def test_invalid_identity_cannot_read_or_write(client, no_database, monkeypatch, claims):
    import requests
    class Response:
        status_code = 200
        def json(self):
            return {"iss": "https://access.line.me", "aud": "2011859796", "sub": "U" + "1" * 32,
                    "exp": int(time.time()) + 600, **claims} if claims else {}
    monkeypatch.setattr(requests, "post", lambda *a, **kw: Response())
    assert client.get("/api/line/preferences", headers={"Authorization": "Bearer synthetic"}).status_code == 401


def test_provider_failure_never_grants_map_access(client, no_database, monkeypatch):
    import requests
    def unavailable(*args, **kwargs):
        raise requests.Timeout("synthetic-private-token")
    monkeypatch.setattr(requests, "post", unavailable)
    response = client.get("/api/line/preferences", headers={"Authorization": "Bearer synthetic"})
    assert response.status_code == 503
    assert "synthetic-private-token" not in response.text
