"""Remember the requested motorcycle model for verified LINE accounts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001_line_motorcycle_settings"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_motorcycle_preferences",
        sa.Column("account_key", sa.Text(), primary_key=True),
        sa.Column("model_id", sa.Text(), nullable=False),
        sa.Column("event_timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("model_id IN ('click', 'aerox', 'nmax', 'scoopy', 'wave', 'pcx', 'fino', 'forza', "
                           "'grand_filano', 'hd_road_glide', 'cbr650r', 'xmax', 'other')",
                           name="ck_line_motorcycle_model"),
        schema="parkmap_line",
    )
    op.create_table(
        "line_webhook_receipts",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column("account_key", sa.Text(), nullable=False),
        sa.Column("payload_hash", sa.Text(), nullable=False),
        sa.Column("reply_messages", JSONB(), nullable=False),
        sa.Column("replied", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        schema="parkmap_line",
    )
    op.create_index("ix_line_webhook_receipts_created_at", "line_webhook_receipts", ["created_at"], schema="parkmap_line")
    op.create_index("ix_line_webhook_receipts_account_key", "line_webhook_receipts", ["account_key"], schema="parkmap_line")


def downgrade() -> None:
    op.drop_table("line_webhook_receipts", schema="parkmap_line")
    op.drop_table("line_motorcycle_preferences", schema="parkmap_line")
