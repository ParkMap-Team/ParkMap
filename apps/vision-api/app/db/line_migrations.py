"""Apply the bot's independent migration history without touching API versions."""
from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade() -> None:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "line-migrations"))
    command.upgrade(config, "head")


if __name__ == "__main__":
    upgrade()
