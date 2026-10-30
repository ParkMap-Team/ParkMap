"""Keep operator lot-model drafts separate from the versions visible to LIFF."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_lot_model_drafts"
down_revision = "0002_processed_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lot_model_drafts",
        sa.Column("site_id", sa.Text(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["parkmap.sites.id"], ondelete="CASCADE"),
        schema="parkmap",
    )


def downgrade() -> None:
    op.drop_table("lot_model_drafts", schema="parkmap")
