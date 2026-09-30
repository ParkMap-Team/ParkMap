from sqlalchemy import Engine, create_engine, event

from app.db.session import database_url
from app.db.tables import SCHEMA


def migration_engine() -> Engine:
    """Engine for Alembic with the default schema pinned to public.

    A role named like SCHEMA would otherwise make it the default schema through "$user", and autogenerate
    would reflect the app tables as unqualified and report them as missing. Tables are always
    schema-qualified, so the pin does not change what migrations touch.
    """
    engine = create_engine(database_url())

    # insert=True runs before the dialect caches its default schema on first connect.
    @event.listens_for(engine, "connect", insert=True)
    def pin_search_path(dbapi_connection, _connection_record) -> None:
        autocommit = dbapi_connection.autocommit
        dbapi_connection.autocommit = True
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET SESSION search_path TO public")
        dbapi_connection.autocommit = autocommit

    return engine


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Autogenerate only looks at the app schema, never at schemas a hosted Postgres owns."""
    return name == SCHEMA if type_ == "schema" else True
