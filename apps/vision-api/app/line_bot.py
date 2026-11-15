"""LIFF account preferences; no chat webhook or outbound messages."""
import hashlib
import os
import re
import time
import uuid

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import SQLAlchemyError

from app.db import line_settings
from app.db.session import open_session, DatabaseNotConfiguredError
from app.services.line_motorcycle_settings import MODEL_LABELS

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def account_key(authorization: str = Header(default="")) -> str:
    channel = os.getenv("LINE_LOGIN_CHANNEL_ID", "").strip()
    if not channel:
        raise HTTPException(503, "LINE Login is not configured.")
    if not authorization.startswith("Bearer ") or not 1 <= len(authorization[7:]) <= 8192:
        raise HTTPException(401, "LINE login is required.")
    try:
        response = requests.post("https://api.line.me/oauth2/v2.1/verify",
            data={"id_token": authorization[7:], "client_id": channel}, timeout=5)
        if response.status_code != 200:
            raise HTTPException(401, "Invalid LINE identity.")
        claims = response.json()
        if (claims.get("iss") != "https://access.line.me" or claims.get("aud") != channel
                or type(claims.get("exp")) is not int or claims["exp"] <= time.time()
                or not re.fullmatch(r"U[0-9a-f]{32}", claims.get("sub", ""))):
            raise HTTPException(401, "Invalid LINE identity.")
        return hashlib.sha256(claims["sub"].encode()).hexdigest()
    except (requests.RequestException, ValueError, TypeError):
        raise HTTPException(503, "LINE identity verification is unavailable.") from None


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str


def preference(key: str, model: str | None = None):
    try:
        with open_session() as session:
            line_settings.lock_account(session, key)
            if model is not None:
                line_settings.save_model(session, key, model, time.time_ns() // 1_000_000, uuid.uuid4().hex)
                session.commit()
            current = line_settings.current_model(session, key)
            return {"model_id": current, "models": [{"id": k, "label": v} for k, v in MODEL_LABELS.items()]}
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
def get_preferences(key: str = Depends(account_key)):
    return preference(key)


@app.put("/api/line/preferences")
def put_preferences(selection: Selection, key: str = Depends(account_key)):
    if selection.model_id not in MODEL_LABELS:
        raise HTTPException(422, "Unsupported motorcycle model.")
    return preference(key, selection.model_id)
