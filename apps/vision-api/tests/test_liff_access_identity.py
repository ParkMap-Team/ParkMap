import hashlib

import pytest
from fastapi import HTTPException

from app.line_bot import account_key


@pytest.mark.parametrize("change,valid", [({}, True), ({"client_id": "other"}, False),
    ({"expires_in": 0}, False), ({"expires_in": True}, False), ({"scope": "profile"}, False)])
def test_access_identity_requires_matching_live_openid_token(monkeypatch, change, valid):
    import requests
    monkeypatch.setenv("LINE_LOGIN_CHANNEL_ID", "2011859796")
    calls = []
    class Response:
        status_code = 200
        def __init__(self, data): self.data = data
        def json(self): return self.data
    def get(url, **kwargs):
        calls.append(url)
        if url.endswith("/verify"):
            assert kwargs["params"] == {"access_token": "synthetic-access"}
            return Response({"client_id": "2011859796", "expires_in": 100, "scope": "openid", **change})
        assert url == "https://api.line.me/oauth2/v2.1/userinfo"
        assert kwargs["headers"]["Authorization"] == "Bearer synthetic-access"
        return Response({"sub": "U" + "4" * 32})
    monkeypatch.setattr(requests, "get", get)
    if valid:
        account = account_key("Bearer synthetic-access", "access")
        assert account.key == hashlib.sha256(("U" + "4" * 32).encode()).hexdigest()
        assert len(calls) == 2
    else:
        with pytest.raises(HTTPException) as caught:
            account_key("Bearer synthetic-access", "access")
        assert caught.value.status_code == 401
        assert len(calls) == 1
