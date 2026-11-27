"""LIFF preferences, follow-event rich menus, and OA confirmation; no chat settings flow."""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    PushMessageRequest,
    TextMessage,
)
from linebot.v3.messaging.exceptions import ApiException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from urllib3.exceptions import HTTPError

from app.db import line_settings
from app.db.session import DatabaseNotConfiguredError, open_session
from app.models import IDENTIFIER_PATTERN
from app.services.line_motorcycle_settings import MODEL_LABELS

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
identity_log = logging.getLogger("parkmap.identity")
MAX_WEBHOOK_BODY_BYTES = 1_000_000
LINE_USER_ID_PATTERN = re.compile(r"U[0-9a-f]{32}")


def reject_identity(reason: str, provider_status: int | None = None) -> None:
    # Only fixed internal reason codes and an HTTP status. Never token, sub, or provider body.
    identity_log.warning("line_identity_rejected reason=%s provider_status=%s", reason, provider_status)
    raise HTTPException(401, "Invalid LINE identity.")


@dataclass(frozen=True)
class Account:
    key: str
    user_id: str = field(repr=False)


def account_key(authorization: str = Header(default=""),
                token_type: str = Header(default="id", alias="X-Line-Token-Type")) -> Account:
    channel = os.getenv("LINE_LOGIN_CHANNEL_ID", "").strip()
    if not channel:
        raise HTTPException(503, "LINE Login is not configured.")
    if not authorization.startswith("Bearer ") or not 1 <= len(authorization[7:]) <= 8192:
        reject_identity("missing_authorization")
    try:
        if token_type == "access":
            verified = requests.get("https://api.line.me/oauth2/v2.1/verify",
                params={"access_token": authorization[7:]}, timeout=5)
            if verified.status_code != 200:
                reject_identity("access_provider_rejected", verified.status_code)
            metadata = verified.json()
            if (not isinstance(metadata, dict) or metadata.get("client_id") != channel
                    or type(metadata.get("expires_in")) not in (int, float)
                    or not 0 < metadata["expires_in"] < float("inf")
                    or not isinstance(metadata.get("scope"), str)
                    or "openid" not in metadata["scope"].split()):
                reject_identity("invalid_access_metadata")
            info = requests.get("https://api.line.me/oauth2/v2.1/userinfo",
                headers={"Authorization": authorization}, timeout=5)
            if info.status_code != 200:
                reject_identity("userinfo_rejected", info.status_code)
            user_info = info.json()
            user = user_info.get("sub") if isinstance(user_info, dict) else None
            if not isinstance(user, str) or not re.fullmatch(r"U[0-9a-f]{32}", user):
                reject_identity("invalid_subject")
            return Account(hashlib.sha256(user.encode()).hexdigest(), user)
        if token_type != "id":
            reject_identity("invalid_token_type")
        response = requests.post("https://api.line.me/oauth2/v2.1/verify",
            data={"id_token": authorization[7:], "client_id": channel}, timeout=5)
        if response.status_code != 200:
            reason = "provider_rejected"
            try:
                description = response.json().get("error_description", "")
                if isinstance(description, str):
                    if "expir" in description.lower():
                        reason = "provider_token_expired"
                    elif "audience" in description.lower() or "client_id" in description.lower():
                        reason = "provider_channel_mismatch"
                    elif "signature" in description.lower():
                        reason = "provider_signature_invalid"
            except (ValueError, TypeError, AttributeError):
                pass
            reject_identity(reason, response.status_code)
        claims = response.json()
        if not isinstance(claims, dict):
            reject_identity("invalid_claims")
        if claims.get("iss") != "https://access.line.me":
            reject_identity("invalid_issuer")
        if claims.get("aud") != channel:
            reject_identity("invalid_audience")
        if type(claims.get("exp")) is not int or claims["exp"] <= time.time():
            reject_identity("expired_or_invalid_expiry")
        if not isinstance(claims.get("sub"), str) or not re.fullmatch(r"U[0-9a-f]{32}", claims["sub"]):
            reject_identity("invalid_subject")
        return Account(hashlib.sha256(claims["sub"].encode()).hexdigest(), claims["sub"])
    except (requests.RequestException, ValueError, TypeError):
        raise HTTPException(503, "LINE identity verification is unavailable.") from None


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str


def notify_saved(account: Account, model: str) -> str:
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if not token:
        return "not_configured"
    try:
        config = Configuration(access_token=token)
        config.retries = 0
        with ApiClient(config) as client:
            MessagingApi(client).push_message(
                PushMessageRequest(to=account.user_id, messages=[TextMessage(
                    text=f"บันทึกรุ่นรถของคุณเป็น {MODEL_LABELS[model]} เรียบร้อยแล้ว 🏍️")]),
                x_line_retry_key=str(uuid.uuid4()), _request_timeout=(5, 5))
        return "accepted"
    except (ApiException, HTTPError, ValueError):
        # Saving the preference succeeds even if LINE cannot accept the notification.
        return "failed"


def preference(account: Account, model: str | None = None):
    key = account.key
    rich_menu_status = None
    try:
        with open_session() as session:
            line_settings.lock_account(session, key)
            if model is not None:
                line_settings.save_model(session, key, model, time.time_ns() // 1_000_000, uuid.uuid4().hex)
            current = line_settings.current_model(session, key)
            if model is not None and current == model:
                # Keep the account lock through the provider change so a concurrent follow event
                # cannot restore the onboarding menu after a successful save.
                rich_menu_status = update_user_rich_menu(account.user_id, onboarding=False)
                session.commit()
        result = {"model_id": current, "models": [{"id": k, "label": v} for k, v in MODEL_LABELS.items()]}
        if model is not None and current == model:
            result["notification_status"] = notify_saved(account, current)
            result["rich_menu_status"] = rich_menu_status
        return result
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        raise HTTPException(503, "Settings storage is unavailable.") from None


@app.get("/api/health")
def health():
    if not os.getenv("LINE_LOGIN_CHANNEL_ID", "").strip():
        raise HTTPException(503, "LINE Login is not configured.")
    try:
        with open_session() as session:
            line_settings.check_ready(session)
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        raise HTTPException(503, "Settings storage is unavailable.") from None
    return {"status": "ok", "service": "parkmap-line-settings"}


def update_user_rich_menu(user_id: str, *, onboarding: bool) -> str:
    """Link the first-run menu or unlink it to reveal the current default menu."""
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    menu_id = os.getenv("LINE_ONBOARDING_RICH_MENU_ID", "").strip()
    if not token or not re.fullmatch(r"richmenu-[A-Za-z0-9]+", menu_id):
        return "not_configured"

    if onboarding:
        method = requests.post
        url = f"https://api.line.me/v2/bot/user/{user_id}/richmenu/{menu_id}"
        operation = "link_onboarding"
    else:
        method = requests.delete
        url = f"https://api.line.me/v2/bot/user/{user_id}/richmenu"
        operation = "unlink_onboarding"
    try:
        response = method(url, headers={"Authorization": f"Bearer {token}"}, timeout=(3, 5))
    except requests.RequestException:
        identity_log.warning("line_rich_menu_update_failed operation=%s provider_status=unavailable", operation)
        return "failed"
    if not 200 <= response.status_code < 300:
        identity_log.warning("line_rich_menu_update_failed operation=%s provider_status=%s", operation, response.status_code)
        return "failed"
    return "updated"


def valid_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9+/]{43}=", signature):
        return False
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, signature)


@app.post("/api/line/webhook")
async def line_webhook(request: Request):
    secret = os.getenv("LINE_CHANNEL_SECRET", "").strip()
    if not secret:
        raise HTTPException(503, "LINE webhook is not configured.")

    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_WEBHOOK_BODY_BYTES:
            raise HTTPException(413, "Webhook body is too large.")
        chunks.append(chunk)
    body = b"".join(chunks)
    signature = request.headers.get("x-line-signature", "")
    if not valid_webhook_signature(body, signature, secret):
        raise HTTPException(401, "Invalid LINE webhook signature.")
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid LINE webhook body.") from None
    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list):
        raise HTTPException(400, "Invalid LINE webhook body.")

    for event in events:
        if not isinstance(event, dict) or event.get("type") != "follow":
            continue
        source = event.get("source")
        user_id = source.get("userId") if isinstance(source, dict) else None
        if not isinstance(user_id, str) or not LINE_USER_ID_PATTERN.fullmatch(user_id):
            raise HTTPException(400, "Invalid LINE follow event.")
        await run_in_threadpool(process_follow_event, user_id)
    return {"status": "ok"}


def process_follow_event(user_id: str) -> None:
    account_key = hashlib.sha256(user_id.encode()).hexdigest()
    try:
        with open_session() as session:
            line_settings.lock_account(session, account_key)
            model = line_settings.current_model(session, account_key)
            status = update_user_rich_menu(user_id, onboarding=model is None)
            if status != "updated":
                raise HTTPException(503, "LINE rich menu could not be updated.")
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        raise HTTPException(503, "Settings storage is unavailable.") from None


@app.get("/api/line/preferences")
def get_preferences(account: Account = Depends(account_key)):
    return preference(account)


RecommendationAccount = Depends(account_key)


@app.get("/api/line/recommendation-owner")
def recommendation_owner(account: Account = RecommendationAccount):
    # Server-to-server only. Never returned by the public LIFF preference proxy.
    return {"owner_key": account.key, "model_id": preference(account)["model_id"]}


@app.put("/api/line/preferences")
def put_preferences(selection: Selection, account: Account = Depends(account_key)):
    if selection.model_id not in MODEL_LABELS:
        raise HTTPException(422, "Unsupported motorcycle model.")
    return preference(account, selection.model_id)


# A lot's metric ground frame spans tens of metres; this only bounds what a rider can store.
MAX_SPOT_COORDINATE_M = 10_000


class ParkedSpot(BaseModel):
    """Where the rider says they parked (ADR 0021). Their own claim: never availability evidence."""
    model_config = ConfigDict(extra="forbid")
    site_id: str = Field(pattern=IDENTIFIER_PATTERN)
    x_m: float = Field(ge=-MAX_SPOT_COORDINATE_M, le=MAX_SPOT_COORDINATE_M, allow_inf_nan=False)
    y_m: float = Field(ge=-MAX_SPOT_COORDINATE_M, le=MAX_SPOT_COORDINATE_M, allow_inf_nan=False)


def parked_spot(account: Account, spot: ParkedSpot | None = None, erase: bool = False):
    try:
        with open_session() as session:
            line_settings.lock_account(session, account.key)
            if erase:
                line_settings.delete_parked_spot(session, account.key)
            elif spot is not None:
                line_settings.save_parked_spot(session, account.key, **spot.model_dump())
            current = line_settings.parked_spot(session, account.key)
            result = {"spot": None if current is None else {
                **ParkedSpot.model_validate(current, from_attributes=True).model_dump(),
                "saved_at": current.saved_at.isoformat()}}
            # Commits a save, an erase, or the deletion of an expired spot.
            session.commit()
            return result
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        raise HTTPException(503, "Parked spot storage is unavailable.") from None


@app.get("/api/line/parked-spot")
def get_parked_spot(account: Account = Depends(account_key)):
    return parked_spot(account)


@app.put("/api/line/parked-spot")
def put_parked_spot(spot: ParkedSpot, account: Account = Depends(account_key)):
    return parked_spot(account, spot)


@app.delete("/api/line/parked-spot")
def delete_parked_spot(account: Account = Depends(account_key)):
    return parked_spot(account, erase=True)
