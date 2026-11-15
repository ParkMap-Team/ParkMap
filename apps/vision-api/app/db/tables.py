"""Postgres tables. Everything lives in the `parkmap` schema so a hosted Postgres
that exposes `public` through a data API (for example Supabase) never publishes them."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.services.line_motorcycle_settings import MODEL_LABELS

SCHEMA = "parkmap"


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


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ParkingArea(Base):
    __tablename__ = "parking_areas"
    __table_args__ = (Index("ix_parkmap_parking_areas_site_id", "site_id"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"))
    camera_id: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LotModelDraft(Base):
    __tablename__ = "lot_model_drafts"

    site_id: Mapped[str] = mapped_column(ForeignKey("parkmap.sites.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)
    base_version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class Calibration(Base):
    __tablename__ = "calibrations"
    __table_args__ = (
        UniqueConstraint("parking_area_id", "version"),
        Index("calibrations_one_active_per_area", "parking_area_id", unique=True, postgresql_where=text("is_active")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parking_area_id: Mapped[str] = mapped_column(ForeignKey("parking_areas.id"))
    version: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LotModel(Base):
    __tablename__ = "lot_models"
    __table_args__ = (
        UniqueConstraint("site_id", "version"),
        Index("lot_models_one_active_per_site", "site_id", unique=True, postgresql_where=text("is_active")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ParkingState(Base):
    """Append-only published states. Old rows are purged by `python -m app.manage purge-states`.

    The latest state is the most recently processed one: a still-image loop revisits older photos,
    so the newest observation is not the state being shown.
    """

    __tablename__ = "parking_states"
    __table_args__ = (Index("parking_states_latest", "parking_area_id", text("processed_at DESC")),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parking_area_id: Mapped[str] = mapped_column(ForeignKey("parking_areas.id"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    calibration_version: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)


class AreaFrame(Base):
    """An analysed photo of a parking area, shown beside the state derived from it (ADR 0017)."""

    __tablename__ = "area_frames"

    parking_area_id: Mapped[str] = mapped_column(ForeignKey("parking_areas.id"), primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    image: Mapped[bytes] = mapped_column(LargeBinary)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
