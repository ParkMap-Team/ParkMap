import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.db.session import get_engine, reset_engine

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"
TABLES = "parkmap.parking_states, parkmap.calibrations, parkmap.lot_models, parkmap.lot_model_drafts, parkmap.parking_areas, parkmap.sites"


@pytest.fixture
def database(monkeypatch):
    """A migrated, empty Postgres. Set PARKMAP_TEST_DATABASE_URL to a disposable database to run these tests."""
    url = os.getenv("PARKMAP_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("PARKMAP_TEST_DATABASE_URL is not set")
    monkeypatch.setenv("DATABASE_URL", url)
    reset_engine()
    command.upgrade(Config(str(ALEMBIC_INI)), "head")
    with get_engine().begin() as connection:
        connection.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY"))
    yield
    reset_engine()


@pytest.fixture
def no_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_engine()
    yield
    reset_engine()
