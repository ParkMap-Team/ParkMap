import base64
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from app.db.line_settings import save_model
from app.db.session import open_session
from app.line_bot import app, update_user_rich_menu


def signature(body: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def test_webhook_rejects_a_bad_signature(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_SECRET", "synthetic-channel-secret")
    with TestClient(app) as client:
        response = client.post(
            "/api/line/webhook",
            content=b'{"events":[]}',
            headers={"x-line-signature": "invalid"},
        )
    assert response.status_code == 401


def test_webhook_accepts_a_signed_empty_event_batch(monkeypatch):
    secret = "synthetic-channel-secret"
    body = json.dumps({"events": []}, separators=(",", ":")).encode()
    monkeypatch.setenv("LINE_CHANNEL_SECRET", secret)
    with TestClient(app) as client:
        response = client.post(
            "/api/line/webhook",
            content=body,
            headers={"x-line-signature": signature(body, secret)},
        )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def webhook_body(user_id: str) -> bytes:
    return json.dumps({"events": [{"type": "follow", "source": {"type": "user", "userId": user_id}}]},
                      separators=(",", ":")).encode()


def test_follow_links_onboarding_menu_when_account_has_no_model(database, monkeypatch):
    import requests

    user_id = "U" + "1" * 32
    secret = "synthetic-channel-secret"
    body = webhook_body(user_id)
    calls = []

    class Response:
        status_code = 200

    def provider(url, **kwargs):
        calls.append((url, kwargs))
        return Response()

    monkeypatch.setenv("LINE_CHANNEL_SECRET", secret)
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "synthetic-access-token")
    monkeypatch.setenv("LINE_ONBOARDING_RICH_MENU_ID", "richmenu-onboarding")
    monkeypatch.setattr(requests, "post", provider)
    with TestClient(app) as client:
        response = client.post("/api/line/webhook", content=body,
            headers={"x-line-signature": signature(body, secret)})

    assert response.status_code == 200
    assert calls == [(f"https://api.line.me/v2/bot/user/{user_id}/richmenu/richmenu-onboarding", {
        "headers": {"Authorization": "Bearer synthetic-access-token"}, "timeout": (3, 5),
    })]


def test_follow_unlinks_onboarding_menu_when_account_already_has_model(database, monkeypatch):
    import hashlib

    import requests

    user_id = "U" + "2" * 32
    with open_session() as session:
        save_model(session, hashlib.sha256(user_id.encode()).hexdigest(), "pcx", 1, "event")
        session.commit()
    secret = "synthetic-channel-secret"
    body = webhook_body(user_id)
    calls = []

    class Response:
        status_code = 200

    def provider(url, **kwargs):
        calls.append((url, kwargs))
        return Response()

    monkeypatch.setenv("LINE_CHANNEL_SECRET", secret)
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "synthetic-access-token")
    monkeypatch.setenv("LINE_ONBOARDING_RICH_MENU_ID", "richmenu-onboarding")
    monkeypatch.setattr(requests, "delete", provider)
    with TestClient(app) as client:
        response = client.post("/api/line/webhook", content=body,
            headers={"x-line-signature": signature(body, secret)})

    assert response.status_code == 200
    assert calls == [(f"https://api.line.me/v2/bot/user/{user_id}/richmenu", {
        "headers": {"Authorization": "Bearer synthetic-access-token"}, "timeout": (3, 5),
    })]


def test_follow_rejects_invalid_user_id_after_signature_verification(monkeypatch):
    secret = "synthetic-channel-secret"
    body = webhook_body("not-a-line-user-id")
    monkeypatch.setenv("LINE_CHANNEL_SECRET", secret)
    with TestClient(app) as client:
        response = client.post("/api/line/webhook", content=body,
            headers={"x-line-signature": signature(body, secret)})
    assert response.status_code == 400


def test_saving_a_model_unlinks_the_onboarding_menu_to_reveal_default(monkeypatch):
    import requests

    user_id = "U" + "3" * 32
    calls = []

    class Response:
        status_code = 200

    def provider(url, **kwargs):
        calls.append((url, kwargs))
        return Response()

    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "synthetic-access-token")
    monkeypatch.setenv("LINE_ONBOARDING_RICH_MENU_ID", "richmenu-onboarding")
    monkeypatch.setattr(requests, "delete", provider)
    assert update_user_rich_menu(user_id, onboarding=False) == "updated"
    assert calls == [(f"https://api.line.me/v2/bot/user/{user_id}/richmenu", {
        "headers": {"Authorization": "Bearer synthetic-access-token"}, "timeout": (3, 5),
    })]


def test_missing_menu_configuration_is_reported_without_provider_request(monkeypatch):
    import requests

    def unexpected_request(*args, **kwargs):
        raise AssertionError("unexpected LINE request")

    monkeypatch.delenv("LINE_CHANNEL_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("LINE_ONBOARDING_RICH_MENU_ID", raising=False)
    monkeypatch.setattr(requests, "delete", unexpected_request)
    assert update_user_rich_menu("U" + "4" * 32, onboarding=False) == "not_configured"
