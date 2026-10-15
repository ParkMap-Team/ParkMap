import threading
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import manage
from app.db.session import get_engine

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"

# pg_locks is read live on every query; pg_stat_activity is cached for the whole transaction.
WAITING_ON_LOCK = text("SELECT count(*) FROM pg_locks WHERE NOT granted AND relation = 'parkmap.parking_states'::regclass")


def wait_until_blocked(connection, timeout_s=10.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if connection.execute(WAITING_ON_LOCK).scalar_one():
            return
        time.sleep(0.05)
    raise AssertionError("The migration never waited on the open insert.")


def test_processed_at_migration_survives_a_state_inserted_by_the_previous_api(database):
    """During a rolling deploy the previous API still inserts v1 states while 0002 runs."""
    config = Config(str(ALEMBIC_INI))
    assert manage.main(["seed-dev"]) == 0
    command.downgrade(config, "0001_live_state")
    engine = get_engine()
    errors = []
    with engine.connect() as observer, engine.connect() as previous_api:
        insert = previous_api.begin()
        previous_api.execute(text(
            "INSERT INTO parkmap.parking_states (parking_area_id, observed_at, calibration_version, payload) "
            "SELECT id, now(), 'v1', '{}'::jsonb FROM parkmap.parking_areas LIMIT 1"
        ))

        def upgrade():
            try:
                command.upgrade(config, "head")
            except SQLAlchemyError as error:
                errors.append(error)

        migration = threading.Thread(target=upgrade)
        migration.start()
        wait_until_blocked(observer)
        insert.commit()
        migration.join(timeout=30)

        assert not migration.is_alive()
        assert errors == []
        assert observer.execute(text("SELECT count(*) FROM parkmap.parking_states")).scalar_one() == 0
