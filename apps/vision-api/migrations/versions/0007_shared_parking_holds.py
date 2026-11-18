"""Durable shared recommendation holds."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007_shared_parking_holds"
down_revision = "0006_frame_crop_classifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parking_holds",
        sa.Column("site_id", sa.Text(), sa.ForeignKey("parkmap.sites.id"), primary_key=True),
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        *[sa.Column(name, sa.Text(), nullable=False) for name in ("channel", "family", "area_id", "geometry_version", "stage")],
        sa.Column("ends_with_photo", sa.Boolean(), nullable=False),
        *[sa.Column(name, sa.DateTime(timezone=True), nullable=False) for name in ("issued_at", "expires_at", "observed_at", "processed_at")],
        sa.Column("result", JSONB(), nullable=False),
        sa.Column("history", JSONB(), nullable=False),
        sa.CheckConstraint("channel IN ('GUARD_BOOTH', 'LINE')"),
        sa.CheckConstraint("stage IN ('HELD', 'AWAITING_CONFIRMATION', 'OCCUPIED_CONFIRMED', 'RELEASED')"),
        sa.CheckConstraint("NOT ends_with_photo OR channel = 'GUARD_BOOTH'"),
        schema="parkmap",
    )
    op.create_index("parking_holds_active_site", "parking_holds", ["site_id", "stage"], schema="parkmap")


def downgrade() -> None:
    op.drop_table("parking_holds", schema="parkmap")
