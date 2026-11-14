"""Keep each parking area's recent analysed photos for LIFF (ADR 0017)."""

import sqlalchemy as sa
from alembic import op

revision = "0005_area_frames"
down_revision = "0004_sripatum_setup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "area_frames",
        sa.Column("parking_area_id", sa.Text(), primary_key=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["parking_area_id"], ["parkmap.parking_areas.id"]),
        schema="parkmap",
    )


def downgrade() -> None:
    op.drop_table("area_frames", schema="parkmap")
