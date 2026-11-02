"""Local operator credentials are shared only by API and loopback UI servers."""

import hmac
import os

from fastapi import Header, HTTPException


def require_editor_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("PARKMAP_EDITOR_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Lot model editor is not configured.")
    if authorization is None or not hmac.compare_digest(authorization.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(401, "Invalid editor token.")
