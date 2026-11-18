"""Store reviewed video crop classifications."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006_frame_crop_classifications"
down_revision = "0005_area_frames"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "frame_crop_classifications",
        sa.Column("review_id", sa.Uuid(), primary_key=True),
        sa.Column("crop_id", sa.Integer(), primary_key=True),
        sa.Column("frame_time_seconds", sa.Float(), nullable=True),
        sa.Column("model_id", sa.Text(), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column(
            "saved_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema="parkmap",
    )


def downgrade() -> None:
    op.drop_table("frame_crop_classifications", schema="parkmap")
