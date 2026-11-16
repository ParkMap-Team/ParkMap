"""Operator commands for sites, parking areas, calibrations, lot models, and retention.

    python -m app.manage <command> --help

Database commands need DATABASE_URL and a migrated schema (`alembic upgrade head`).
"""

import argparse
import hashlib
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
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from dotenv import load_dotenv
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import repository
from app.db.session import DatabaseNotConfiguredError, open_session
from app.db.tables import SCHEMA, ParkingArea, Site
from app.models import (
    IDENTIFIER_PATTERN,
    LiveRegion,
    LotModelDefinition,
    MotorcycleProxy,
    ParkingStatePublish,
    SiteSummary,
)
from app.services.live_state_service import (
    CALIBRATION_FILES,
    CalibrationFilesUnavailableError,
    calibration_version,
)
from app.services.lot_model_editor_service import validate_site_definition
from app.worker.publisher import StatePublisher

logger = logging.getLogger("app.manage")
VISION_API_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIRECTORY = VISION_API_ROOT / "config"
DEV_FIXTURE = VISION_API_ROOT / "fixtures" / "dev-site.json"
DEV_CALIBRATION_VERSION = "dev-fixture"
SEED_SNAPSHOT = VISION_API_ROOT / "migrations/data/0004_sripatum_setup.json"


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
    try:
        validate_site_definition(session, site_id, definition)
    except ValueError as error:
        raise CommandError(str(error)) from error
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


def restore_seed_calibration(session: Session, args: argparse.Namespace) -> str:
    """Explicitly restore shared snapshot bytes; never overwrite operator files."""
    area = _require_area(session, args.parking_area_id)
    active = repository.active_calibrations(session, [area.id]).get(area.id)
    snapshot = json.loads(SEED_SNAPSHOT.read_text(encoding="utf-8"))
    saved = next((item for item in snapshot["calibrations"] if item["parking_area_id"] == area.id), None)
    if active is None or saved is None or active.version != saved["version"]:
        raise CommandError("The active calibration does not match this shared snapshot; no files restored.")
    files = saved["config_files"]
    if set(files) != set(CALIBRATION_FILES):
        raise CommandError("Shared snapshot has an unexpected calibration file list.")
    raw_files = {name: files[name].encode("utf-8") for name in CALIBRATION_FILES}
    digest = hashlib.sha256()
    for name, raw in raw_files.items():
        digest.update(name.encode())
        digest.update(len(raw).to_bytes(8, "big"))
        digest.update(raw)
    if (f"files-sha256:{digest.hexdigest()}" != active.version
            or {name: json.loads(raw) for name, raw in raw_files.items()} != active.payload
            or active.payload["parking_calibration.json"]["camera_id"] != area.camera_id):
        raise CommandError("Shared calibration identity mismatch; no files restored.")
    directory = Path(args.output_dir)
    conflicts = [name for name, raw in raw_files.items()
                 if (directory / name).exists() and (directory / name).read_bytes() != raw]
    if conflicts:
        raise CommandError("Existing calibration differs; back it up and choose an empty directory first: " + ", ".join(conflicts))
    try:
        directory.mkdir(parents=True, exist_ok=True)
        for name, raw in raw_files.items():
            target = directory / name
            if not target.exists():
                with target.open("xb") as stream:
                    stream.write(raw)
    except OSError as error:
        raise CommandError("Unable to restore calibration files; check the output directory.") from error
    return f"Restored matching calibration files for {area.id}; database settings were unchanged."


def _same_lot_model(payload: object, expected: dict[str, Any]) -> bool:
    try:
        return LotModelDefinition.model_validate(payload) == LotModelDefinition.model_validate(expected)
    except ValidationError:
        return False


def _setup_differences(session: Session, config_dir: Path) -> list[str]:
    heads = set(ScriptDirectory.from_config(Config(str(VISION_API_ROOT / "alembic.ini"))).get_heads())
    current = set(MigrationContext.configure(session.connection(), opts={"version_table_schema": SCHEMA}).get_current_heads())
    if current != heads:
        # The other checks read tables an older schema may not have.
        return [f"database schema is at {', '.join(sorted(current)) or 'no revision'}, expected {', '.join(sorted(heads))}; run alembic upgrade head"]
    snapshot = json.loads(SEED_SNAPSHOT.read_text(encoding="utf-8"))
    differences = []
    expected_site = snapshot["site"]
    site = session.get(Site, expected_site["id"])
    if site is None:
        return [f"site {expected_site['id']} is missing"]
    if (site.name, site.latitude, site.longitude) != (expected_site["name"], expected_site["latitude"], expected_site["longitude"]):
        differences.append(f"site {site.id} name or location differs")
    expected_areas = {area["id"]: area for area in snapshot["parking_areas"]}
    areas = {area.id: area for area in repository.site_areas(session, site.id)}
    differences += [f"parking area {area_id} is not in this version" for area_id in sorted(areas.keys() - expected_areas.keys())]
    for area_id, expected in expected_areas.items():
        area = areas.get(area_id)
        if area is None:
            differences.append(f"parking area {area_id} is missing")
        elif (area.camera_id, area.name) != (expected["camera_id"], expected["name"]):
            differences.append(f"parking area {area_id} has camera {area.camera_id!r} and name {area.name!r}, expected {expected['camera_id']!r} and {expected['name']!r}")
    lot = repository.active_lot_model(session, site.id)
    if lot is None or not _same_lot_model(lot.payload, snapshot["lot_model"]):
        differences.append(f"active lot model of {site.id} differs")
    calibrations = repository.active_calibrations(session, list(expected_areas))
    for expected in snapshot["calibrations"]:
        area_id = expected["parking_area_id"]
        payload = {name: json.loads(text) for name, text in expected["config_files"].items()}
        active = calibrations.get(area_id)
        if active is None or active.version != expected["version"] or active.payload != payload:
            differences.append(f"active calibration of {area_id} differs from {expected['version']}")
    versions = {expected["version"] for expected in snapshot["calibrations"]}
    try:
        files_version = calibration_version(config_dir)
    except CalibrationFilesUnavailableError as error:
        differences.append(f"{config_dir}: {error}")
    else:
        if files_version not in versions:
            differences.append(f"calibration files in {config_dir} are {files_version}; restore them with restore-seed-calibration")
    # Imported here: the module loads the inference runtime, which only this command needs.
    from app.services.segmentation_experiment_service import (
        SEGMENTATION_WEIGHTS_SHA256,
        segmentation_model_path,
    )
    weights = segmentation_model_path()
    if not weights.is_file():
        differences.append(f"segmentation weights {weights} are missing; run scripts/download_segmentation_weights.py")
    else:
        with weights.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != SEGMENTATION_WEIGHTS_SHA256:
                differences.append(f"segmentation weights {weights} are not the pinned yolo11m-seg.pt")
    return differences


def verify_setup(session: Session, args: argparse.Namespace) -> str:
    """Compare schema, shared site setup, calibration files and weights with this version. Read-only."""
    differences = _setup_differences(session, Path(args.config_dir))
    if differences:
        raise CommandError("Setup differs from this version; nothing was changed:\n- " + "\n- ".join(differences))
    return "Setup matches this version: schema, site, parking areas, lot model, calibration, calibration files and segmentation weights."


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

    command = commands.add_parser("restore-seed-calibration", help="restore shared snapshot files matching the active calibration without overwriting existing files")
    command.add_argument("--parking-area-id", type=identifier, required=True)
    command.add_argument("--output-dir", required=True)
    command.set_defaults(handler=restore_seed_calibration)

    command = commands.add_parser("verify-setup", help="report every way the database, config/ files and weights differ from this version (read-only)")
    command.add_argument("--config-dir", default=str(CONFIG_DIRECTORY))
    command.set_defaults(handler=verify_setup)

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
