from alembic import context
from sqlalchemy import text

from app.db.line_tables import Base, SCHEMA
from app.db.session import get_engine


with get_engine().begin() as connection:
    # Serialize startup migrations, even when containers briefly overlap.
    connection.execute(text("SELECT pg_advisory_xact_lock(734821905)"))
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
    context.configure(connection=connection, target_metadata=Base.metadata,
                      version_table_schema=SCHEMA, include_schemas=True)
    with context.begin_transaction():
        context.run_migrations()
