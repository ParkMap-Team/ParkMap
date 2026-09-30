import os
from collections.abc import Iterator
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


class DatabaseNotConfiguredError(RuntimeError):
    """DATABASE_URL is not set."""


def database_url() -> str:
    """Read DATABASE_URL and select the psycopg 3 driver for plain Postgres URLs."""
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseNotConfiguredError("DATABASE_URL is not configured.")
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return create_engine(database_url(), pool_pre_ping=True)


@lru_cache(maxsize=1)
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def open_session() -> Session:
    return _session_factory()()


def reset_engine() -> None:
    """Drop cached connections, for tests and after changing DATABASE_URL."""
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    _session_factory.cache_clear()


def get_session() -> Iterator[Session]:
    """FastAPI dependency. Live endpoints answer 503 when storage is not configured."""
    try:
        session = open_session()
    except DatabaseNotConfiguredError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Live state storage is not configured.") from error
    with session:
        yield session
