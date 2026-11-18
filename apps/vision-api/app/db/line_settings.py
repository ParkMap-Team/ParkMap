
from datetime import timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.line_tables import LineMotorcyclePreference, LineParkedSpot
from app.services.line_motorcycle_settings import MODEL_LABELS


def lock_account(session: Session, account_key: str) -> None:
    # Serialize one account even before it has a preference row. Other accounts use other locks.
    key = int.from_bytes(bytes.fromhex(account_key[:16]), "big", signed=True)
    session.execute(select(func.pg_advisory_xact_lock(key)))


def check_ready(session: Session) -> None:
    session.execute(select(LineMotorcyclePreference.account_key).limit(1))



def current_model(session: Session, account_key: str) -> str | None:
    preference = session.get(LineMotorcyclePreference, account_key)
    return preference.model_id if preference else None


def save_model(session: Session, account_key: str, model: str, timestamp: int, event_id: str) -> str:
    if model not in MODEL_LABELS:
        raise ValueError("Unsupported motorcycle model")
    preference = LineMotorcyclePreference
    statement = insert(preference).values(account_key=account_key, model_id=model,
                                          event_timestamp_ms=timestamp, event_id=event_id)
    session.execute(statement.on_conflict_do_update(
        index_elements=[preference.account_key],
        set_={"model_id": model, "event_timestamp_ms": timestamp, "event_id": event_id, "updated_at": func.now()},
        where=or_(preference.event_timestamp_ms < timestamp,
                  (preference.event_timestamp_ms == timestamp) & (preference.event_id < event_id)),
    ))
    return current_model(session, account_key)


PARKED_SPOT_TTL = timedelta(hours=24)


def parked_spot(session: Session, account_key: str) -> LineParkedSpot | None:
    """The account's marked spot; one older than a day is deleted instead of returned."""
    session.execute(delete(LineParkedSpot).where(
        LineParkedSpot.account_key == account_key,
        LineParkedSpot.saved_at <= func.now() - PARKED_SPOT_TTL,
    ))
    return session.get(LineParkedSpot, account_key)


def save_parked_spot(session: Session, account_key: str, site_id: str, x_m: float, y_m: float) -> None:
    spot = {"site_id": site_id, "x_m": x_m, "y_m": y_m}
    statement = insert(LineParkedSpot).values(account_key=account_key, **spot)
    session.execute(statement.on_conflict_do_update(
        index_elements=[LineParkedSpot.account_key], set_={**spot, "saved_at": func.now()}))


def delete_parked_spot(session: Session, account_key: str) -> None:
    session.execute(delete(LineParkedSpot).where(LineParkedSpot.account_key == account_key))
