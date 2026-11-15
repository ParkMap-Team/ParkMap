"""Public LINE webhook process. No vision or operator routes are mounted here."""

import json
import os
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from linebot.v3.messaging import ApiClient, Configuration, Message, MessagingApi, ReplyMessageRequest
from linebot.v3.messaging.exceptions import ApiException
from linebot.v3.webhook import SignatureValidator
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from urllib3.exceptions import HTTPError

from app.db import line_settings
from app.db.session import DatabaseNotConfiguredError, open_session
from app.services.line_motorcycle_settings import SettingsEvent, parse_event

ReplySender = Callable[[str, list[dict[str, Any]]], None]
MAX_WEBHOOK_BYTES = 1024 * 1024


def require_configuration() -> None:
    if not os.getenv("LINE_CHANNEL_SECRET", "").strip() or not os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip():
        raise HTTPException(503, "LINE bot is not configured.")


def send_line_reply(token: str, messages: list[dict[str, Any]]) -> None:
    access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if not access_token:
        raise HTTPException(503, "LINE bot is not configured.")
    try:
        configuration = Configuration(access_token=access_token)
        configuration.retries = 0
        with ApiClient(configuration) as client:
            MessagingApi(client).reply_message(
                ReplyMessageRequest(reply_token=token, messages=[Message.from_dict(m) for m in messages]),
                _request_timeout=(5, 5),
            )
    except (ApiException, HTTPError, ValueError):
        raise HTTPException(503, "LINE reply is temporarily unavailable.") from None


def process_event(event: SettingsEvent, reply_sender: ReplySender) -> None:
    try:
        with open_session() as session:
            pending = line_settings.prepare_reply(session, event)
            # Commit the setting and retry receipt before asking LINE to confirm it.
            session.commit()
        if not pending:
            return
        with open_session() as session:
            receipt = line_settings.pending_receipt(session, event)
            if receipt is not None:
                # The per-account lock is held for this bounded provider call, in a worker thread.
                reply_sender(event.reply_token, receipt.reply_messages)
                receipt.replied = True
                session.commit()
    except ValueError:
        raise HTTPException(400, "Invalid webhook event.") from None
    except (DatabaseNotConfiguredError, SQLAlchemyError):
        raise HTTPException(503, "Settings storage is temporarily unavailable.") from None


def create_app(*, reply_sender: ReplySender = send_line_reply) -> FastAPI:
    application = FastAPI(title="ParkMap LINE bot", docs_url=None, redoc_url=None, openapi_url=None)

    @application.get("/api/health")
    def health():
        require_configuration()
        try:
            with open_session() as session:
                line_settings.check_ready(session)
        except (DatabaseNotConfiguredError, SQLAlchemyError):
            raise HTTPException(503, "Settings storage is temporarily unavailable.") from None
        return {"status": "ok", "service": "parkmap-line-bot"}

    @application.post("/api/line/webhook")
    async def webhook(request: Request):
        require_configuration()
        secret = os.getenv("LINE_CHANNEL_SECRET", "").strip()
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_WEBHOOK_BYTES:
                raise HTTPException(413, "Webhook body is too large.")
        try:
            valid_signature = SignatureValidator(secret).validate(
                body.decode("utf-8"), request.headers.get("x-line-signature", ""))
        except (ValueError, UnicodeError):
            valid_signature = False
        if not valid_signature:
            raise HTTPException(401, "Invalid LINE signature.")
        try:
            payload = json.loads(body)
            events = payload["events"]
            if not isinstance(events, list) or len(events) > 100 or any(not isinstance(e, dict) for e in events):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, "Invalid webhook payload.") from None
        try:
            parsed = [item for event in events if (item := parse_event(event)) is not None]
        except ValueError:
            raise HTTPException(400, "Invalid webhook event.") from None
        for event in parsed:
            await run_in_threadpool(process_event, event, reply_sender)
        return {"ok": True}

    return application


app = create_app()
