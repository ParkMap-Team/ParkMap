"""Bot-owned tables, isolated from the vision API migration history."""
from datetime import datetime
from typing import Any
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, Index, MetaData, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from app.services.line_motorcycle_settings import MODEL_LABELS

SCHEMA = "parkmap_line"

class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


class LineMotorcyclePreference(Base):
    __tablename__ = "line_motorcycle_preferences"
    __table_args__ = (CheckConstraint(
        "model_id IN (" + ", ".join(repr(model) for model in MODEL_LABELS) + ")",
        name="ck_line_motorcycle_model",
    ),)

    account_key: Mapped[str] = mapped_column(Text, primary_key=True)
    model_id: Mapped[str] = mapped_column(Text)
    event_timestamp_ms: Mapped[int] = mapped_column(BigInteger)
    event_id: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LineParkedSpot(Base):
    """Where a rider said they parked (ADR 0021): their claim, never availability evidence."""

    __tablename__ = "line_parked_spots"

    account_key: Mapped[str] = mapped_column(Text, primary_key=True)
    site_id: Mapped[str] = mapped_column(Text)
    x_m: Mapped[float] = mapped_column(Float)
    y_m: Mapped[float] = mapped_column(Float)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LineWebhookReceipt(Base):
    __tablename__ = "line_webhook_receipts"
    __table_args__ = (Index("ix_line_webhook_receipts_created_at", "created_at"),
                      Index("ix_line_webhook_receipts_account_key", "account_key"))

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    account_key: Mapped[str] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(Text)
    reply_messages: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    replied: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
