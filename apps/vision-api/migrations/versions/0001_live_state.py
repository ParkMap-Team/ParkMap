"""Live state storage: sites, parking areas, calibrations, lot models, parking states.

Revision ID: 0001_live_state
Revises:
Create Date: 2026-09-30
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_live_state"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "parkmap"


def _timestamp(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        _timestamp("created_at"),
        schema=SCHEMA,
    )
    op.create_table(
        "parking_areas",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("site_id", sa.Text(), sa.ForeignKey(f"{SCHEMA}.sites.id"), nullable=False),
        sa.Column("camera_id", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        _timestamp("created_at"),
        schema=SCHEMA,
    )
    op.create_index("ix_parkmap_parking_areas_site_id", "parking_areas", ["site_id"], schema=SCHEMA)
    op.create_table(
        "calibrations",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("parking_area_id", sa.Text(), sa.ForeignKey(f"{SCHEMA}.parking_areas.id"), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        _timestamp("created_at"),
        sa.UniqueConstraint("parking_area_id", "version"),
        schema=SCHEMA,
    )
    op.create_index("calibrations_one_active_per_area", "calibrations", ["parking_area_id"], unique=True, schema=SCHEMA, postgresql_where=sa.text("is_active"))
    op.create_table(
        "lot_models",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("site_id", sa.Text(), sa.ForeignKey(f"{SCHEMA}.sites.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        _timestamp("created_at"),
        sa.UniqueConstraint("site_id", "version"),
        schema=SCHEMA,
    )
    op.create_index("lot_models_one_active_per_site", "lot_models", ["site_id"], unique=True, schema=SCHEMA, postgresql_where=sa.text("is_active"))
    op.create_table(
        "parking_states",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("parking_area_id", sa.Text(), sa.ForeignKey(f"{SCHEMA}.parking_areas.id"), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        _timestamp("received_at"),
        sa.Column("calibration_version", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        schema=SCHEMA,
    )
    op.create_index("parking_states_latest", "parking_states", ["parking_area_id", sa.text("observed_at DESC")], schema=SCHEMA)


def downgrade() -> None:
    op.drop_table("parking_states", schema=SCHEMA)
    op.drop_table("lot_models", schema=SCHEMA)
    op.drop_table("calibrations", schema=SCHEMA)
    op.drop_table("parking_areas", schema=SCHEMA)
    op.drop_table("sites", schema=SCHEMA)
