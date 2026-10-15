"""Operator commands for sites, parking areas, calibrations, lot models, and retention.

    python -m app.manage <command> --help

Database commands need DATABASE_URL and a migrated schema (`alembic upgrade head`).
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import repository
from app.db.session import DatabaseNotConfiguredError, open_session
from app.db.tables import ParkingArea, Site
from app.models import IDENTIFIER_PATTERN, LiveRegion, LotModelDefinition, MotorcycleProxy, ParkingStatePublish, SiteSummary
from app.services.live_state_service import CALIBRATION_FILES, CalibrationFilesUnavailableError, calibration_version, validate_lot_model
from app.worker.publisher import StatePublisher

logger = logging.getLogger("app.manage")
VISION_API_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIRECTORY = VISION_API_ROOT / "config"
DEV_FIXTURE = VISION_API_ROOT / "fixtures" / "dev-site.json"
DEV_CALIBRATION_VERSION = "dev-fixture"


class CommandError(RuntimeError):
    """A command cannot complete; the message is shown to the operator."""


def identifier(value: str) -> str:
    if not re.fullmatch(IDENTIFIER_PATTERN, value):
        raise argparse.ArgumentTypeError("use lowercase letters, digits, and hyphens (max 63 characters)")
    return value


def _require_site(session: Session, site_id: str) -> None:
    if session.get(Site, site_id) is None:
        raise CommandError(f"Site {site_id} does not exist.")


def _require_area(session: Session, area_id: str) -> ParkingArea:
    area = session.get(ParkingArea, area_id)
    if area is None:
        raise CommandError(f"Parking area {area_id} does not exist.")
    return area


def _set_lot_model(session: Session, site_id: str, definition: LotModelDefinition) -> int:
    _require_site(session, site_id)
    try:
        validate_lot_model(definition)
    except ValueError as error:
        raise CommandError(str(error)) from error
    site_area_ids = {area.id for area in repository.site_areas(session, site_id)}
    unknown = sorted({area.parking_area_id for area in definition.parking_areas} - site_area_ids)
    if unknown:
        raise CommandError(f"Lot model references parking areas not registered for {site_id}: {', '.join(unknown)}.")
    return repository.activate_lot_model(session, site_id, definition)


def _load_dev_fixture() -> dict[str, Any]:
    return json.loads(DEV_FIXTURE.read_text())


def create_site(session: Session, args: argparse.Namespace) -> str:
    summary = SiteSummary(site_id=args.site_id, name=args.name, latitude=args.latitude, longitude=args.longitude)
    repository.create_site(session, summary.site_id, summary.name, summary.latitude, summary.longitude)
    return f"Created site {summary.site_id}."


def create_parking_area(session: Session, args: argparse.Namespace) -> str:
    _require_site(session, args.site_id)
    repository.create_parking_area(session, args.parking_area_id, args.site_id, args.camera_id, args.name)
    return f"Created parking area {args.parking_area_id} for camera {args.camera_id}."


def set_lot_model(session: Session, args: argparse.Namespace) -> str:
    try:
        definition = LotModelDefinition.model_validate_json(Path(args.file).read_text())
    except (OSError, ValidationError) as error:
        raise CommandError(f"Lot model file is invalid: {error}") from error
    version = _set_lot_model(session, args.site_id, definition)
    return f"Activated lot model version {version} for {args.site_id}."


def register_calibration(session: Session, args: argparse.Namespace) -> str:
    """Store the current config/ calibration files and make them the area's active calibration."""
    area = _require_area(session, args.parking_area_id)
    directory = Path(args.config_dir)
    version = calibration_version(directory)
    try:
        payload = {name: json.loads((directory / name).read_text()) for name in CALIBRATION_FILES}
    except json.JSONDecodeError as error:
        raise CommandError(f"Calibration file is not valid JSON: {error}") from error
    camera_id = payload["parking_calibration.json"].get("camera_id")
    if camera_id != area.camera_id:
        raise CommandError(f"Calibration is for camera {camera_id!r}, but {area.id} uses camera {area.camera_id!r}.")
    repository.activate_calibration(session, area.id, version, payload)
    return f"Activated calibration {version} for {area.id}."


def seed_dev(session: Session, args: argparse.Namespace) -> str:
    """Create the fake development site from fixtures/dev-site.json. Never run against production."""
    fixture = _load_dev_fixture()
    site, area = fixture["site"], fixture["parking_area"]
    if session.get(Site, site["site_id"]) is None:
        create_site(session, argparse.Namespace(**site))
        session.flush()
    if session.get(ParkingArea, area["parking_area_id"]) is None:
        create_parking_area(session, argparse.Namespace(site_id=site["site_id"], **area))
        session.flush()
    version = _set_lot_model(session, site["site_id"], LotModelDefinition.model_validate(fixture["lot_model"]))
    repository.activate_calibration(session, area["parking_area_id"], DEV_CALIBRATION_VERSION, {"notice": fixture["notice"]})
    return f"Seeded {site['site_id']} with lot model version {version} and calibration {DEV_CALIBRATION_VERSION}."


def remove_site(session: Session, args: argparse.Namespace) -> str:
    """Delete a site and everything it owns. The site ID is typed twice so a typo cannot remove another site."""
    if args.confirm != args.site_id:
        raise CommandError("--confirm must repeat --site-id exactly.")
    _require_site(session, args.site_id)
    areas = [area.id for area in repository.site_areas(session, args.site_id)]
    repository.remove_site(session, args.site_id)
    return f"Removed site {args.site_id} with parking areas {', '.join(areas) or 'none'}, their calibrations, lot models, and states."


def purge_states(session: Session, args: argparse.Namespace) -> str:
    if args.older_than_days < 1:
        raise CommandError("--older-than-days must be at least 1.")
    removed = repository.purge_states(session, datetime.now(UTC) - timedelta(days=args.older_than_days))
    return f"Removed {removed} parking states older than {args.older_than_days} days."


def dev_state(now: datetime) -> ParkingStatePublish:
    """The fixture's sample state, labelled SYNTHETIC_FIXTURE and stamped with `now`. The fixture has no surveyed calibration."""
    fixture = _load_dev_fixture()
    sample = fixture["sample_state"]
    return ParkingStatePublish(
        parking_area_id=fixture["parking_area"]["parking_area_id"],
        camera_id=fixture["parking_area"]["camera_id"],
        source="SYNTHETIC_FIXTURE",
        observed_at=now,
        processed_at=now,
        calibration_version=DEV_CALIBRATION_VERSION,
        calibration_provenance="ESTIMATED",
        analysis_version=sample["analysis_version"],
        regions=[LiveRegion.model_validate(region) for region in sample["regions"]],
        motorcycles=[MotorcycleProxy.model_validate(proxy) for proxy in sample["motorcycles"]],
    )


def publish_dev_state(args: argparse.Namespace) -> str:
    """Send the fixture state through the real ingest endpoint so the LIFF app can be built without a camera."""
    api_url = os.getenv("PARKMAP_API_URL", "")
    token = os.getenv("PARKMAP_WORKER_TOKEN", "")
    if not api_url or not token:
        raise CommandError("PARKMAP_API_URL and PARKMAP_WORKER_TOKEN are required.")
    publisher = StatePublisher(api_url, token)
    published = 0
    try:
        while True:
            try:
                publisher.publish(dev_state(datetime.now(UTC)))
                published += 1
            except httpx.HTTPError as error:
                if args.once:
                    raise CommandError(f"Publishing failed: {error}") from error
                logger.warning("Publishing failed: %s", error)
            if args.once:
                break
            time.sleep(args.interval_s)
    except KeyboardInterrupt:
        pass
    finally:
        publisher.close()
    return f"Published {published} synthetic states."


DatabaseCommand = Callable[[Session, argparse.Namespace], str]


def run_database_command(command: DatabaseCommand, args: argparse.Namespace) -> str:
    with open_session() as session:
        try:
            message = command(session, args)
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise CommandError(f"Database rejected the change: {error.orig}") from error
    return message


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.manage", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    command = commands.add_parser("create-site", help="register a site")
    command.add_argument("--site-id", type=identifier, required=True)
    command.add_argument("--name", required=True)
    command.add_argument("--latitude", type=float, required=True)
    command.add_argument("--longitude", type=float, required=True)
    command.set_defaults(handler=create_site)

    command = commands.add_parser("create-parking-area", help="register a parking area and its one camera")
    command.add_argument("--parking-area-id", type=identifier, required=True)
    command.add_argument("--site-id", type=identifier, required=True)
    command.add_argument("--camera-id", required=True)
    command.add_argument("--name", required=True)
    command.set_defaults(handler=create_parking_area)

    command = commands.add_parser("set-lot-model", help="validate a surveyed lot model JSON file and make it the active version")
    command.add_argument("--site-id", type=identifier, required=True)
    command.add_argument("--file", required=True)
    command.set_defaults(handler=set_lot_model)

    command = commands.add_parser("register-calibration", help="store the config/ calibration files as the area's active calibration")
    command.add_argument("--parking-area-id", type=identifier, required=True)
    command.add_argument("--config-dir", default=str(CONFIG_DIRECTORY))
    command.set_defaults(handler=register_calibration)

    command = commands.add_parser("seed-dev", help="create the fake development site (never in production)")
    command.set_defaults(handler=seed_dev)

    command = commands.add_parser("remove-site", help="delete a site with its parking areas, calibrations, lot models, and states")
    command.add_argument("--site-id", type=identifier, required=True)
    command.add_argument("--confirm", required=True, help="the site ID again")
    command.set_defaults(handler=remove_site)

    command = commands.add_parser("purge-states", help="delete parking states older than the retention window")
    command.add_argument("--older-than-days", type=int, default=30)
    command.set_defaults(handler=purge_states)

    command = commands.add_parser("publish-dev-state", help="publish the fake SYNTHETIC_FIXTURE state through the ingest API")
    command.add_argument("--interval-s", type=float, default=3.0)
    command.add_argument("--once", action="store_true")
    command.set_defaults(handler=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = build_parser().parse_args(argv)
    try:
        message = publish_dev_state(args) if args.handler is None else run_database_command(args.handler, args)
    except (CommandError, CalibrationFilesUnavailableError, DatabaseNotConfiguredError, ValidationError) as error:
        logger.error("%s", error)
        return 1
    logger.info("%s", message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
