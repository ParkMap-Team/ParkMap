"""LIFF preferences with an OA confirmation after saving; no chat webhook."""
import hashlib
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import SQLAlchemyError
from linebot.v3.messaging import ApiClient, Configuration, MessagingApi, PushMessageRequest, TextMessage
from linebot.v3.messaging.exceptions import ApiException
from urllib3.exceptions import HTTPError

from app.db import line_settings
from app.db.session import open_session, DatabaseNotConfiguredError
from app.services.line_motorcycle_settings import MODEL_LABELS

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
identity_log = logging.getLogger("parkmap.identity")


def reject_identity(reason: str, provider_status: int | None = None) -> None:
    # Only fixed internal reason codes and an HTTP status. Never token, sub, or provider body.
    identity_log.warning("line_identity_rejected reason=%s provider_status=%s", reason, provider_status)
    raise HTTPException(401, "Invalid LINE identity.")


@dataclass(frozen=True)
class Account:
    key: str
    user_id: str = field(repr=False)


def account_key(authorization: str = Header(default="")) -> Account:
    channel = os.getenv("LINE_LOGIN_CHANNEL_ID", "").strip()
    if not channel:
        raise HTTPException(503, "LINE Login is not configured.")
    if not authorization.startswith("Bearer ") or not 1 <= len(authorization[7:]) <= 8192:
        reject_identity("missing_authorization")
    try:
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
    try:
        with open_session() as session:
            line_settings.lock_account(session, key)
            if model is not None:
                line_settings.save_model(session, key, model, time.time_ns() // 1_000_000, uuid.uuid4().hex)
                session.commit()
            current = line_settings.current_model(session, key)
        result = {"model_id": current, "models": [{"id": k, "label": v} for k, v in MODEL_LABELS.items()]}
        if model is not None and current == model:
            result["notification_status"] = notify_saved(account, current)
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


@app.get("/api/line/preferences")
def get_preferences(account: Account = Depends(account_key)):
    return preference(account)


@app.put("/api/line/preferences")
def put_preferences(selection: Selection, account: Account = Depends(account_key)):
    if selection.model_id not in MODEL_LABELS:
        raise HTTPException(422, "Unsupported motorcycle model.")
    return preference(account, selection.model_id)
