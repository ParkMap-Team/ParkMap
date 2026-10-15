"""Parking states record when they were processed; the latest state is the most recently processed.

Existing states are deleted: they use state schema version 1, which has no processing time or
calibration provenance, and they are older than any freshness window readers accept.

Revision ID: 0002_processed_at
Revises: 0001_live_state
Create Date: 2026-10-15
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_processed_at"
down_revision: str | None = "0001_live_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "parkmap"


def upgrade() -> None:
    op.execute(f"DELETE FROM {SCHEMA}.parking_states")
    op.add_column("parking_states", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False), schema=SCHEMA)
    op.drop_index("parking_states_latest", table_name="parking_states", schema=SCHEMA)
    op.create_index("parking_states_latest", "parking_states", ["parking_area_id", sa.text("processed_at DESC")], schema=SCHEMA)


def downgrade() -> None:
    op.execute(f"DELETE FROM {SCHEMA}.parking_states")
    op.drop_index("parking_states_latest", table_name="parking_states", schema=SCHEMA)
    op.create_index("parking_states_latest", "parking_states", ["parking_area_id", sa.text("observed_at DESC")], schema=SCHEMA)
    op.drop_column("parking_states", "processed_at", schema=SCHEMA)
