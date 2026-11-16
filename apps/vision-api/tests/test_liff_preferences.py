import time

import pytest
from fastapi.testclient import TestClient

from app.line_bot import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("LINE_LOGIN_CHANNEL_ID", "2011859796")
    monkeypatch.delenv("LINE_CHANNEL_ACCESS_TOKEN", raising=False)
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


@pytest.mark.parametrize("status", [200, 401, 500, 0])
def test_save_notifies_only_verified_user_after_commit(database, client, monkeypatch, status):
    import hashlib
    import json
    import requests
    import urllib3
    from app.db.session import open_session
    from app.db.line_settings import current_model

    user = "U" + "3" * 32
    class IdentityResponse:
        status_code = 200
        def json(self):
            return {"iss": "https://access.line.me", "aud": "2011859796", "sub": user,
                    "exp": int(time.time()) + 600}
    monkeypatch.setattr(requests, "post", lambda *a, **kw: IdentityResponse())
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "synthetic-access-token")
    pushes = []
    def provider(pool, method, url, **kwargs):
        assert method == "POST" and url == "https://api.line.me/v2/bot/message/push"
        with open_session() as session:
            assert current_model(session, hashlib.sha256(user.encode()).hexdigest()) == "pcx"
        pushes.append(json.loads(kwargs["body"]))
        assert kwargs["headers"]["X-Line-Retry-Key"]
        if status == 0:
            raise urllib3.exceptions.ReadTimeoutError(pool, url, "synthetic-access-token")
        return urllib3.HTTPResponse(status=status, headers={"Content-Type": "application/json"},
            body=json.dumps({"sentMessages": [{"id": "synthetic-message"}]} if status == 200 else
                            {"message": "synthetic-access-token"}).encode())
    monkeypatch.setattr(urllib3.PoolManager, "request", provider)
    headers = {"Authorization": "Bearer synthetic-id-token"}
    assert client.get("/api/line/preferences", headers=headers).status_code == 200
    assert not pushes
    response = client.put("/api/line/preferences", headers=headers, json={"model_id": "pcx"})
    assert response.status_code == 200 and response.json()["model_id"] == "pcx"
    assert response.json()["notification_status"] == ("accepted" if status == 200 else "failed")
    assert pushes == [{"to": user, "notificationDisabled": False,
        "messages": [{"type": "text", "text": "บันทึกรุ่นรถของคุณเป็น pcx เรียบร้อยแล้ว 🏍️"}]}]
    assert user not in response.text and "synthetic-access-token" not in response.text
