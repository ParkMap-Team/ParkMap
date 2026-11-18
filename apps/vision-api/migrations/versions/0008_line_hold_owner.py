"""Associate active LINE recommendations with verified, hashed accounts."""
import sqlalchemy as sa
from alembic import op

revision = "0008_line_hold_owner"
down_revision = "0007_shared_parking_holds"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parking_holds", sa.Column("owner_key", sa.Text(), nullable=True), schema="parkmap")
    op.create_index("parking_holds_one_active_line_owner", "parking_holds", ["site_id", "owner_key"],
                    schema="parkmap", unique=True,
                    postgresql_where=sa.text("channel = 'LINE' AND owner_key IS NOT NULL AND stage IN ('HELD', 'AWAITING_CONFIRMATION')"))


def downgrade():
    op.drop_index("parking_holds_one_active_line_owner", table_name="parking_holds", schema="parkmap")
    op.drop_column("parking_holds", "owner_key", schema="parkmap")
