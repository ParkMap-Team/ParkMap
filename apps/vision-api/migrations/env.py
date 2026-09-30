from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import text

from app.db.migrations import include_name, migration_engine
from app.db.tables import SCHEMA, Base

load_dotenv()
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)


def run_migrations_online() -> None:
    engine = migration_engine()
    with engine.connect() as connection:
        # The version table lives in the app schema, so the schema must exist first.
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        context.configure(connection=connection, target_metadata=Base.metadata, version_table_schema=SCHEMA, include_schemas=True, include_name=include_name)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported; set DATABASE_URL and run online.")
run_migrations_online()
