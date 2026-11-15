import base64
import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event, Lock

import urllib3
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.session import open_session
from app.db.tables import LineMotorcyclePreference, LineWebhookReceipt
from app.line_bot import create_app
from test_line_flex import actions


def message_text(message):
    return json.dumps(message, ensure_ascii=False)

SECRET = "synthetic-test-channel-secret"
USER_A = "U" + "1" * 32
USER_B = "U" + "2" * 32
EVENT_TIME_BASE = int(datetime.now(UTC).timestamp() * 1000) - 5000


def event(data, *, user=USER_A, event_id="event-1", timestamp=1000):
    return {
        "type": "postback", "webhookEventId": event_id, "timestamp": EVENT_TIME_BASE + timestamp,
        "source": {"type": "user", "userId": user},
        "replyToken": "synthetic-reply-" + event_id,
        "postback": {"data": data},
    }


def send(client, *events, signature=None):
    body = json.dumps({"events": list(events)}, ensure_ascii=False).encode()
    signature = signature or base64.b64encode(hmac.digest(SECRET.encode(), body, "sha256")).decode()
    return client.post("/api/line/webhook", content=body,
                       headers={"Content-Type": "application/json", "X-Line-Signature": signature})


@pytest.fixture
def bot(monkeypatch):
    monkeypatch.setenv("LINE_CHANNEL_SECRET", SECRET)
    monkeypatch.setenv("LINE_CHANNEL_ACCESS_TOKEN", "synthetic-test-access-token")
    replies = []

    def reply(token, messages):
        replies.append({"token": token, "messages": messages})

    with TestClient(create_app(reply_sender=reply)) as client:
        yield client, replies


def test_settings_offers_my_motorcycle_menu(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:settings")).status_code == 200
    action = next(actions(replies[0]["messages"][0]))
    assert action["label"] == "ตั้งค่ารุ่นรถของฉัน"
    assert action["type"] == "postback"
    assert action["data"] == "parkmap:vehicle"


def test_model_menu_offers_exactly_twelve_requested_models_and_other(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:vehicle")).status_code == 200
    assert len(replies) == 1
    message = replies[0]["messages"][0]
    assert message["altText"].startswith("ตั้งค่ารุ่นรถของฉัน")
    model_actions = list(actions(message))
    ids = [action["data"].removeprefix("parkmap:vehicle:set:") for action in model_actions]
    assert ids == ["click", "aerox", "nmax", "scoopy", "wave", "pcx", "fino", "forza",
                   "grand_filano", "hd_road_glide", "cbr650r", "xmax", "other"]
    assert model_actions[-1]["label"] == "อื่นๆ"
    assert all(action["type"] == "postback" and len(action["label"]) <= 20 for action in model_actions)


@pytest.mark.parametrize("model,label", [
    ("click", "click"), ("aerox", "aerox"), ("nmax", "nmax"), ("scoopy", "scoopy"),
    ("wave", "wave"), ("pcx", "pcx"), ("fino", "fino"), ("forza", "forza"),
    ("grand_filano", "grand_filano"), ("hd_road_glide", "hd_road_glide"),
    ("cbr650r", "cbr650r"), ("xmax", "xmax"), ("other", "อื่นๆ"),
])
def test_selection_is_confirmed_and_remembered_after_bot_restart(database, bot, model, label):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:" + model)).status_code == 200
    assert len(replies) == 1
    assert replies[0]["messages"][0]["text"] == f"ตั้งค่ารุ่นรถของคุณเป็น {label} เรียบร้อยแล้ว"
    reopened = []

    def reply(token, messages):
        reopened.extend(messages)

    with TestClient(create_app(reply_sender=reply)) as another_client:
        assert send(another_client, event("parkmap:vehicle", event_id="event-2", timestamp=2000)).status_code == 200
    assert f"รุ่นปัจจุบัน: {label}" in message_text(reopened[0])


def test_redelivered_selection_does_not_repeat_the_confirmation(database, bot):
    client, replies = bot
    selection = event("parkmap:vehicle:set:click")
    assert send(client, selection).status_code == 200
    selection["deliveryContext"] = {"isRedelivery": True}
    assert send(client, selection).status_code == 200
    assert len(replies) == 1


def test_bot_readiness_requires_channel_configuration_and_storage(database, bot, monkeypatch):
    client, _ = bot
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/health").json()["service"] == "parkmap-line-bot"
    monkeypatch.delenv("LINE_CHANNEL_SECRET")
    assert client.get("/api/health").status_code == 503


def test_accounts_are_isolated_and_a_newer_choice_can_replace_the_previous_one(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:click")).status_code == 200
    assert send(client, event("parkmap:vehicle", user=USER_B, event_id="other-account")).status_code == 200
    assert "รุ่นปัจจุบัน:" not in message_text(replies[-1]["messages"][0])
    assert send(client, event("parkmap:vehicle:set:forza", event_id="event-2", timestamp=2000)).status_code == 200
    assert send(client, event("parkmap:vehicle", event_id="event-3", timestamp=3000)).status_code == 200
    assert "รุ่นปัจจุบัน: forza" in message_text(replies[-1]["messages"][0])


def test_an_older_delayed_selection_cannot_overwrite_the_latest_model(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:pcx", event_id="newer", timestamp=2000)).status_code == 200
    assert send(client, event("parkmap:vehicle:set:click", event_id="older", timestamp=1000)).status_code == 200
    assert "รุ่นรถปัจจุบันของคุณคือ pcx" in replies[-1]["messages"][0]["text"]
    assert send(client, event("parkmap:vehicle", event_id="read", timestamp=3000)).status_code == 200
    assert "รุ่นปัจจุบัน: pcx" in message_text(replies[-1]["messages"][0])


def test_provider_failure_keeps_the_saved_choice_and_redelivery_retries_once(database, bot):
    client, replies = bot
    accepted = []
    attempts = 0

    def flaky_reply(token, messages):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise HTTPException(503, "Provider unavailable")
        accepted.extend(messages)

    selection = event("parkmap:vehicle:set:xmax")
    with TestClient(create_app(reply_sender=flaky_reply)) as flaky:
        assert send(flaky, selection).status_code == 503
        assert send(client, event("parkmap:vehicle", event_id="read")).status_code == 200
        assert "รุ่นปัจจุบัน: xmax" in message_text(replies[-1]["messages"][0])
        assert send(flaky, selection).status_code == 200
        assert send(flaky, selection).status_code == 200
    assert len(accepted) == 1
    assert accepted[0]["text"] == "ตั้งค่ารุ่นรถของคุณเป็น xmax เรียบร้อยแล้ว"


def test_a_pending_confirmation_describes_the_latest_saved_choice(database, bot):
    client, replies = bot

    def unavailable(token, messages):
        raise HTTPException(503, "Provider unavailable")

    old = event("parkmap:vehicle:set:click")
    with TestClient(create_app(reply_sender=unavailable)) as failing:
        assert send(failing, old).status_code == 503
    assert send(client, event("parkmap:vehicle:set:nmax", event_id="new", timestamp=2000)).status_code == 200
    assert send(client, old).status_code == 200
    assert "รุ่นรถปัจจุบันของคุณคือ nmax" in replies[-1]["messages"][0]["text"]


def test_concurrent_redelivery_does_not_send_two_confirmations(database, bot):
    entered, release = Event(), Event()
    accepted, guard = [], Lock()

    def slow_reply(token, messages):
        entered.set()
        assert release.wait(5)
        with guard:
            accepted.extend(messages)

    with TestClient(create_app(reply_sender=slow_reply)) as client, ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send, client, event("parkmap:vehicle:set:wave"))
        assert entered.wait(5)
        second = pool.submit(send, client, event("parkmap:vehicle:set:wave"))
        release.set()
        assert first.result(10).status_code == second.result(10).status_code == 200
    assert len(accepted) == 1


@pytest.mark.parametrize("signature", ["not-base64", "aGVsbG8=", base64.b64encode(b"0" * 32).decode()])
def test_bad_signatures_are_rejected_before_storage(no_database, bot, signature):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:click"), signature=signature).status_code == 401
    assert not replies


def test_signature_is_checked_over_the_original_bytes_before_json_parsing(no_database, bot):
    client, replies = bot
    assert client.post("/api/line/webhook", content=b"not-json").status_code == 401
    body = b"not-json"
    signature = base64.b64encode(hmac.digest(SECRET.encode(), body, "sha256")).decode()
    assert client.post("/api/line/webhook", content=body, headers={"X-Line-Signature": signature}).status_code == 400
    assert not replies


@pytest.mark.parametrize("change", [
    {"postback": {"data": "parkmap:vehicle:set:unknown-model"}},
    {"source": {"type": "user", "userId": "not-a-line-user"}},
    {"replyToken": ""}, {"webhookEventId": ""}, {"timestamp": True}, {"timestamp": 2**63},
])
def test_invalid_settings_events_are_rejected_before_storage(no_database, bot, change):
    client, replies = bot
    invalid = {**event("parkmap:vehicle:set:click"), **change}
    assert send(client, invalid).status_code == 400
    assert not replies


def test_group_conversations_and_unrelated_events_do_not_expose_private_settings(no_database, bot):
    client, replies = bot
    group = event("parkmap:vehicle")
    group["source"] = {"type": "group", "userId": USER_A, "groupId": "synthetic-group"}
    assert send(client, group, {"type": "follow"}, event("unrelated-command")).status_code == 200
    assert not replies
    assert send(client).status_code == 200  # LINE console webhook verification


def test_reusing_an_event_id_for_another_actor_or_action_is_rejected(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:click")).status_code == 200
    assert send(client, event("parkmap:vehicle:set:nmax")).status_code == 400
    assert send(client, event("parkmap:vehicle", user=USER_B)).status_code == 400
    assert len(replies) == 1


def test_storage_keeps_only_account_hash_and_never_reply_tokens(database, bot, caplog):
    client, _ = bot
    selection = event("parkmap:vehicle:set:other")
    assert send(client, selection).status_code == 200
    with open_session() as session:
        keys = list(session.scalars(select(LineMotorcyclePreference.account_key)))
        assert keys == [hashlib.sha256(USER_A.encode()).hexdigest()]
        receipt = session.get(LineWebhookReceipt, "event-1")
        assert receipt.replied
        stored = json.dumps(receipt.reply_messages, ensure_ascii=False)
        assert USER_A not in stored and selection["replyToken"] not in stored
    assert USER_A not in caplog.text
    assert SECRET not in caplog.text and "synthetic-test-access-token" not in caplog.text


def test_expired_receipt_cleanup_is_bounded_and_keeps_current_receipts(database, bot):
    client, _ = bot
    with open_session() as session:
        session.add_all(LineWebhookReceipt(event_id=f"old-{index}", account_key="a" * 64,
            payload_hash="b" * 64, reply_messages=[], replied=True,
            created_at=datetime.now(UTC) - timedelta(days=8)) for index in range(101))
        session.commit()
    assert send(client, event("parkmap:settings")).status_code == 200
    with open_session() as session:
        assert session.scalar(select(func.count()).select_from(LineWebhookReceipt)) == 2


def test_unconfigured_bot_and_oversized_payload_fail_closed(no_database, bot, monkeypatch):
    client, replies = bot
    assert client.get("/api/health").status_code == 503
    assert client.post("/api/line/webhook", content=b"x" * (1024 * 1024 + 1)).status_code == 413
    monkeypatch.delenv("LINE_CHANNEL_ACCESS_TOKEN")
    assert send(client).status_code == 503
    assert not replies


def test_bot_does_not_mount_vision_or_operator_endpoints(bot):
    client, _ = bot
    for path in ["/api/sites", "/api/detection/analyze", "/api/calibration", "/docs", "/openapi.json"]:
        assert client.get(path).status_code == 404


@pytest.mark.parametrize("provider_status,valid_response", [(200, True), (200, False), (401, False), (500, False)])
def test_line_reply_uses_the_reply_api_and_sanitizes_provider_errors(
        database, bot, monkeypatch, provider_status, valid_response):
    requests = []
    def provider(pool, method, url, **kwargs):
        requests.append((method, url, kwargs))
        return urllib3.HTTPResponse(status=provider_status,
            body=json.dumps({"sentMessages": [{"id": "synthetic-message"}]} if valid_response else
                            {"message": "synthetic-test-access-token"}).encode(),
            headers={"Content-Type": "application/json"})

    monkeypatch.setattr(urllib3.PoolManager, "request", provider)
    with TestClient(create_app()) as client:
        response = send(client, event("parkmap:settings"))
    assert response.status_code == (200 if valid_response else 503)
    assert len(requests) == 1
    method, url, request = requests[0]
    assert method == "POST" and url == "https://api.line.me/v2/bot/message/reply"
    assert request["headers"]["Authorization"] == "Bearer synthetic-test-access-token"
    assert request["timeout"].connect_timeout == request["timeout"].read_timeout == 5
    payload = json.loads(request["body"])
    assert payload["replyToken"] == "synthetic-reply-event-1"
    assert payload["messages"][0]["type"] == "flex"
    assert "synthetic-test-access-token" not in response.text


def test_line_reply_timeout_returns_a_retryable_error_without_leaking_provider_details(database, bot, monkeypatch):
    def provider(pool, method, url, **kwargs):
        raise urllib3.exceptions.ReadTimeoutError(pool, url, "synthetic-test-access-token")

    monkeypatch.setattr(urllib3.PoolManager, "request", provider)
    with TestClient(create_app()) as client:
        response = send(client, event("parkmap:settings"))
    assert response.status_code == 503
    assert "synthetic-test-access-token" not in response.text


def test_tampered_bytes_fail_signature_validation(no_database, bot):
    client, replies = bot
    body = json.dumps({"events": [event("parkmap:vehicle:set:click")]}).encode()
    signature = base64.b64encode(hmac.digest(SECRET.encode(), body, "sha256")).decode()
    response = client.post("/api/line/webhook", content=body.replace(b"click", b"pcx"),
                           headers={"X-Line-Signature": signature})
    assert response.status_code == 401
    assert not replies


def test_entire_batch_is_validated_before_any_choice_is_saved(database, bot):
    client, replies = bot
    assert send(client, event("parkmap:vehicle:set:click"),
                event("parkmap:vehicle:set:unknown", event_id="bad")).status_code == 400
    assert not replies
    assert send(client, event("parkmap:vehicle", event_id="read")).status_code == 200
    assert "รุ่นปัจจุบัน:" not in message_text(replies[-1]["messages"][0])


def test_too_many_events_are_rejected_before_storage(no_database, bot):
    client, replies = bot
    assert send(client, *({"type": "unrelated"} for _ in range(101))).status_code == 400
    assert not replies


@pytest.mark.parametrize("offset", [-8 * 86400, 10 * 60])
def test_expired_or_future_signed_events_are_rejected_before_storage(no_database, bot, offset):
    client, replies = bot
    invalid = event("parkmap:vehicle:set:click")
    invalid["timestamp"] = int((datetime.now(UTC) + timedelta(seconds=offset)).timestamp() * 1000)
    assert send(client, invalid).status_code == 400
    assert not replies
