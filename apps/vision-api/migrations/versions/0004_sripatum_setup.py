"""Seed the explicitly shared active Sripatum setup, preserving existing sites."""

import hashlib
import json
import logging
from pathlib import Path

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, insert

revision = "0004_sripatum_setup"
down_revision = "0003_lot_model_drafts"
branch_labels = None
depends_on = None

SNAPSHOT = Path(__file__).resolve().parents[1] / "data/0004_sripatum_setup.json"
SNAPSHOT_SHA256 = "f4cf12e14ec79accdcab2719d5c3ad2af68931434b96f6f3b324f94b3ef705d7"
logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(canonical).hexdigest() != SNAPSHOT_SHA256:
        raise RuntimeError("Sripatum setup snapshot checksum mismatch")
    connection = op.get_bind()
    sites = sa.table("sites", sa.column("id", sa.Text()), sa.column("name", sa.Text()),
                     sa.column("latitude", sa.Float()), sa.column("longitude", sa.Float()), schema="parkmap")
    areas = sa.table("parking_areas", sa.column("id", sa.Text()), sa.column("site_id", sa.Text()),
                     sa.column("camera_id", sa.Text()), sa.column("name", sa.Text()), schema="parkmap")
    calibrations = sa.table("calibrations", sa.column("parking_area_id", sa.Text()), sa.column("version", sa.Text()),
                            sa.column("payload", JSONB()), sa.column("is_active", sa.Boolean()), schema="parkmap")
    lots = sa.table("lot_models", sa.column("site_id", sa.Text()), sa.column("version", sa.Integer()),
                   sa.column("payload", JSONB()), sa.column("is_active", sa.Boolean()), schema="parkmap")
    site_id = data["site"]["id"]
    if connection.scalar(sa.select(sites.c.id).where(sites.c.id == site_id)) is not None:
        logger.info("Sripatum setup already exists; preserved all operator data")
        return
    for area in data["parking_areas"]:
        conflict = connection.scalar(sa.select(areas.c.id).where(sa.or_(
            areas.c.id == area["id"], areas.c.camera_id == area["camera_id"])))
        if conflict is not None:
            logger.warning("Sripatum setup skipped: an area/camera identifier is already in use")
            return
    inserted = connection.scalar(insert(sites).values(**data["site"]).on_conflict_do_nothing(index_elements=["id"]).returning(sites.c.id))
    if inserted is None:
        logger.info("Sripatum setup was created concurrently; preserved it")
        return
    for area in data["parking_areas"]:
        connection.execute(areas.insert().values(**area))
    for calibration in data["calibrations"]:
        connection.execute(calibrations.insert().values(parking_area_id=calibration["parking_area_id"],
            version=calibration["version"], payload={name: json.loads(raw) for name, raw in calibration["config_files"].items()},
            is_active=True))
    connection.execute(lots.insert().values(site_id=site_id, version=1, payload=data["lot_model"], is_active=True))
    logger.info("Seeded Sripatum site, camera, active lot model and calibration; no parking history imported")


def downgrade() -> None:
    # A seed may have been edited or acquired observations since upgrade.
    # Reversing the revision must never delete an operator's site or children.
    logger.info("Sripatum setup data retained on downgrade; no operator data deleted")
