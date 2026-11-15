from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.line_tables import LineMotorcyclePreference, LineWebhookReceipt
from app.services.line_motorcycle_settings import MODEL_LABELS, SettingsEvent, reply_message


def lock_account(session: Session, account_key: str) -> None:
    # Serialize one account even before it has a preference row. Other accounts use other locks.
    key = int.from_bytes(bytes.fromhex(account_key[:16]), "big", signed=True)
    session.execute(select(func.pg_advisory_xact_lock(key)))


def check_ready(session: Session) -> None:
    session.execute(select(LineMotorcyclePreference.account_key).limit(1))
    session.execute(select(LineWebhookReceipt.event_id).limit(1))


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


def prepare_reply(session: Session, event: SettingsEvent) -> bool:
    lock_account(session, event.account_key)
    expired = select(LineWebhookReceipt.event_id).where(
        LineWebhookReceipt.created_at < datetime.now(UTC) - timedelta(days=7),
    ).order_by(LineWebhookReceipt.created_at).limit(100)
    session.execute(delete(LineWebhookReceipt).where(LineWebhookReceipt.event_id.in_(expired)))
    receipt = session.get(LineWebhookReceipt, event.event_id)
    if receipt:
        if receipt.account_key != event.account_key or receipt.payload_hash != event.payload_hash:
            raise ValueError("Webhook event identity conflict")
        return not receipt.replied
    if event.model is not None:
        save_model(session, event.account_key, event.model, event.timestamp, event.event_id)
    message = reply_message(event, current_model(session, event.account_key))
    session.add(LineWebhookReceipt(event_id=event.event_id, account_key=event.account_key,
                                  payload_hash=event.payload_hash, reply_messages=[message], replied=False))
    session.flush()
    return True


def pending_receipt(session: Session, event: SettingsEvent) -> LineWebhookReceipt | None:
    lock_account(session, event.account_key)
    receipt = session.scalar(select(LineWebhookReceipt).where(
        LineWebhookReceipt.event_id == event.event_id,
    ).with_for_update())
    if receipt is None or receipt.replied:
        return None
    # A delayed provider retry must describe the latest saved preference.
    receipt.reply_messages = [reply_message(event, current_model(session, event.account_key))]
    return receipt
