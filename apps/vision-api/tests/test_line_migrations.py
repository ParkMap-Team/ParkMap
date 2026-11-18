from sqlalchemy import inspect, text

from app.db.line_migrations import upgrade
from app.db.session import get_engine


def test_bot_migrations_are_repeatable_and_do_not_change_api_history(database):
    with get_engine().connect() as connection:
        before = connection.scalar(text("SELECT version_num FROM parkmap.alembic_version"))
    upgrade()
    upgrade()
    with get_engine().connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM parkmap.alembic_version")) == before
        assert connection.scalar(text("SELECT version_num FROM parkmap_line.alembic_version")) == "0002_line_parked_spots"
        assert set(inspect(connection).get_table_names(schema="parkmap_line")) == {
            "alembic_version", "line_motorcycle_preferences", "line_parked_spots", "line_webhook_receipts",
        }
