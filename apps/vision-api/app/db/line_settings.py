
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.line_tables import LineMotorcyclePreference
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
