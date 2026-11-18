"""Keep the one spot each verified LINE account marked as where it parked (ADR 0021)."""

import sqlalchemy as sa
from alembic import op

revision = "0002_line_parked_spots"
down_revision = "0001_line_motorcycle_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_parked_spots",
        sa.Column("account_key", sa.Text(), primary_key=True),
        sa.Column("site_id", sa.Text(), nullable=False),
        sa.Column("x_m", sa.Float(), nullable=False),
        sa.Column("y_m", sa.Float(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        schema="parkmap_line",
    )


def downgrade() -> None:
    op.drop_table("line_parked_spots", schema="parkmap_line")
