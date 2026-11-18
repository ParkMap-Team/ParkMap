import time

import pytest
import requests
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db.session import get_engine
from app.line_bot import app

SPOT = {"site_id": "sripatum", "x_m": 12.5, "y_m": -3.25}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("LINE_LOGIN_CHANNEL_ID", "2011859796")
    with TestClient(app) as client:
        yield client


def as_account(monkeypatch, digit: str) -> dict[str, str]:
    class Response:
        status_code = 200
        def json(self):
            return {"iss": "https://access.line.me", "aud": "2011859796",
                    "sub": "U" + digit * 32, "exp": int(time.time()) + 600}
    monkeypatch.setattr(requests, "post", lambda *a, **kw: Response())
    return {"Authorization": f"Bearer synthetic-id-token-{digit}"}


def test_spot_requires_verified_identity(client, no_database):
    assert client.get("/api/line/recommendation-owner").status_code == 401
    assert client.get("/api/line/parked-spot").status_code == 401
    assert client.put("/api/line/parked-spot", json=SPOT).status_code == 401
    assert client.delete("/api/line/parked-spot").status_code == 401


def test_recommendation_identity_is_verified_stable_and_account_specific(database, client, monkeypatch):
    headers = as_account(monkeypatch, "1")
    client.put("/api/line/preferences", headers=headers, json={"model_id": "forza"})
    first = client.get("/api/line/recommendation-owner", headers=headers).json()
    assert first["model_id"] == "forza" and len(first["owner_key"]) == 64
    assert "U" + "1" * 32 not in str(first)
    assert client.get("/api/line/recommendation-owner", headers=headers).json() == first
    other = client.get("/api/line/recommendation-owner", headers=as_account(monkeypatch, "2")).json()
    assert other["owner_key"] != first["owner_key"] and other["model_id"] is None


def test_rider_saves_replaces_and_deletes_their_spot(database, client, monkeypatch):
    headers = as_account(monkeypatch, "1")
    assert client.get("/api/line/parked-spot", headers=headers).json() == {"spot": None}

    saved = client.put("/api/line/parked-spot", headers=headers, json=SPOT)
    assert saved.status_code == 200
    assert {key: saved.json()["spot"][key] for key in SPOT} == SPOT
    assert saved.json()["spot"]["saved_at"]

    moved = {**SPOT, "x_m": 4.0}
    client.put("/api/line/parked-spot", headers=headers, json=moved)
    assert client.get("/api/line/parked-spot", headers=headers).json()["spot"]["x_m"] == 4.0

    assert client.delete("/api/line/parked-spot", headers=headers).json() == {"spot": None}
    assert client.get("/api/line/parked-spot", headers=headers).json() == {"spot": None}


def test_one_account_never_sees_another_accounts_spot(database, client, monkeypatch):
    client.put("/api/line/parked-spot", headers=as_account(monkeypatch, "1"), json=SPOT)
    assert client.get("/api/line/parked-spot", headers=as_account(monkeypatch, "2")).json() == {"spot": None}


def test_a_spot_older_than_a_day_is_deleted_instead_of_returned(database, client, monkeypatch):
    headers = as_account(monkeypatch, "1")
    client.put("/api/line/parked-spot", headers=headers, json=SPOT)
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE parkmap_line.line_parked_spots SET saved_at = now() - interval '24 hours 1 second'"))
    assert client.get("/api/line/parked-spot", headers=headers).json() == {"spot": None}
    with get_engine().connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM parkmap_line.line_parked_spots")).scalar_one() == 0


@pytest.mark.parametrize("change", [
    {"site_id": "Bad Site"}, {"site_id": ""}, {"x_m": 10_001}, {"y_m": -10_001},
    {"x_m": "nan"}, {"y_m": "Infinity"}, {"extra": 1},
])
def test_invalid_spot_is_rejected(client, no_database, monkeypatch, change):
    headers = as_account(monkeypatch, "1")
    assert client.put("/api/line/parked-spot", headers=headers, json={**SPOT, **change}).status_code == 422


def test_storage_failure_is_unavailable(client, no_database, monkeypatch):
    headers = as_account(monkeypatch, "1")
    assert client.get("/api/line/parked-spot", headers=headers).status_code == 503
