import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import func, select

from app.db.session import open_session
from app.db.tables import Calibration, LotModel, ParkingArea, ParkingState, Site
from app.services.live_state_service import _fingerprint, calibration_version

ROOT = Path(__file__).resolve().parents[1]
REVISION = "0004_sripatum_setup"
PREVIOUS = "0003_lot_model_drafts"
SNAPSHOT = ROOT / "migrations/data/0004_sripatum_setup.json"


def migrate(direction, target):
    getattr(command, direction)(Config(str(ROOT / "alembic.ini")), target)


def test_snapshot_preserves_calibration_bytes_and_contains_only_active_setup():
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert data["site"]["id"] == "sripatum"
    assert len(data["parking_areas"]) == len(data["calibrations"]) == 1
    assert "parking_states" not in data and "drafts" not in data
    calibration = data["calibrations"][0]
    assert _fingerprint({name: text.encode("utf-8") for name, text in calibration["config_files"].items()}) == calibration["version"]


def test_fresh_database_gets_active_site_map_camera_and_calibration_without_history(database):
    migrate("downgrade", PREVIOUS)
    migrate("upgrade", REVISION)
    with open_session() as session:
        site = session.get(Site, "sripatum")
        assert site is not None
        area = session.get(ParkingArea, "sripatum-near-lot")
        assert area.site_id == site.id and area.camera_id == "SPU_CAM_01"
        lot = session.scalar(select(LotModel).where(LotModel.site_id == site.id, LotModel.is_active))
        calibration = session.scalar(select(Calibration).where(Calibration.parking_area_id == area.id, Calibration.is_active))
        assert lot is not None and calibration is not None
        data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        assert lot.payload == data["lot_model"]
        assert calibration.version == data["calibrations"][0]["version"]
        assert session.scalar(select(func.count()).select_from(ParkingState)) == 0
    migrate("upgrade", REVISION)
    with open_session() as session:
        assert session.scalar(select(func.count()).select_from(LotModel)) == 1


def test_existing_site_is_preserved_and_downgrade_does_not_delete_operator_data(database):
    migrate("downgrade", PREVIOUS)
    with open_session() as session:
        session.add(Site(id="sripatum", name="Operator-owned name", latitude=1, longitude=2))
        session.commit()
    migrate("upgrade", REVISION)
    migrate("downgrade", PREVIOUS)
    with open_session() as session:
        assert session.get(Site, "sripatum").name == "Operator-owned name"
        assert session.scalar(select(func.count()).select_from(ParkingArea)) == 0


def test_camera_owned_by_another_site_is_preserved(database):
    migrate("downgrade", PREVIOUS)
    with open_session() as session:
        session.add(Site(id="other", name="Existing site", latitude=1, longitude=2))
        session.flush()
        session.add(ParkingArea(id="other-area", site_id="other", camera_id="SPU_CAM_01", name="Existing camera"))
        session.commit()
    migrate("upgrade", REVISION)
    with open_session() as session:
        assert session.get(Site, "sripatum") is None
        assert session.get(ParkingArea, "other-area").site_id == "other"
        assert session.scalar(select(func.count()).select_from(Calibration)) == 0


@pytest.mark.parametrize("target", [PREVIOUS, REVISION])
def test_seeded_data_survives_revision_round_trip(database, target):
    migrate("downgrade", PREVIOUS)
    migrate("upgrade", REVISION)
    with open_session() as session:
        session.get(Site, "sripatum").name = "Edited after migration"
        session.commit()
    migrate("downgrade", PREVIOUS)
    if target == REVISION:
        migrate("upgrade", REVISION)
    with open_session() as session:
        assert session.get(Site, "sripatum").name == "Edited after migration"


def test_restore_seed_files_keeps_fingerprint_and_refuses_existing_different_files(database, tmp_path):
    from app import manage

    migrate("downgrade", PREVIOUS)
    migrate("upgrade", REVISION)
    command_args = ["restore-seed-calibration", "--parking-area-id", "sripatum-near-lot", "--output-dir", str(tmp_path)]
    assert manage.main(command_args) == 0
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert calibration_version(tmp_path) == data["calibrations"][0]["version"]
    assert manage.main(command_args) == 0
    target = tmp_path / "parking_calibration.json"
    target.write_bytes(b"operator file")
    assert manage.main(command_args) == 1
    assert target.read_bytes() == b"operator file"


@pytest.fixture
def seeded_setup(database, tmp_path, monkeypatch):
    """A fresh database at head with the shared setup, its restored calibration files, and stand-in weights."""
    import hashlib

    from app import manage
    from app.services import segmentation_experiment_service

    migrate("downgrade", PREVIOUS)
    migrate("upgrade", "head")
    config = tmp_path / "config"
    assert manage.main(["restore-seed-calibration", "--parking-area-id", "sripatum-near-lot", "--output-dir", str(config)]) == 0
    weights = tmp_path / "weights.pt"
    weights.write_bytes(b"pinned weights")
    monkeypatch.setenv("PARKMAP_SEGMENTATION_MODEL_PATH", str(weights))
    monkeypatch.setattr(segmentation_experiment_service, "SEGMENTATION_WEIGHTS_SHA256", hashlib.sha256(b"pinned weights").hexdigest())
    return config


def verify(config):
    """The command's message: alembic's logging setup can disable app loggers, so it is not read from logs."""
    import argparse

    from app import manage

    with open_session() as session:
        try:
            return manage.verify_setup(session, argparse.Namespace(config_dir=str(config)))
        except manage.CommandError as error:
            return str(error)


def test_a_fresh_setup_matches_this_version(seeded_setup):
    from app import manage

    assert verify(seeded_setup).startswith("Setup matches this version")
    assert manage.main(["verify-setup", "--config-dir", str(seeded_setup)]) == 0


def test_every_difference_is_reported_and_nothing_is_changed(seeded_setup, tmp_path, monkeypatch):
    from app import manage

    with open_session() as session:
        session.get(ParkingArea, "sripatum-near-lot").camera_id = "OTHER_CAM"
        session.scalar(select(LotModel).where(LotModel.is_active)).payload = {"rows": []}
        session.add(ParkingArea(id="extra-area", site_id="sripatum", camera_id="EXTRA_CAM", name="Extra"))
        session.commit()
    (seeded_setup / "parking_calibration.json").write_bytes(b"{}")
    monkeypatch.setenv("PARKMAP_SEGMENTATION_MODEL_PATH", str(tmp_path / "missing.pt"))

    message = verify(seeded_setup)
    for difference in ["parking area sripatum-near-lot has camera 'OTHER_CAM'", "parking area extra-area is not in this version",
                       "active lot model of sripatum differs", "calibration files in", "segmentation weights"]:
        assert difference in message
    assert manage.main(["verify-setup", "--config-dir", str(seeded_setup)]) == 1
    with open_session() as session:
        assert session.get(ParkingArea, "sripatum-near-lot").camera_id == "OTHER_CAM"
    assert (seeded_setup / "parking_calibration.json").read_bytes() == b"{}"


def test_other_weights_and_calibration_do_not_match(seeded_setup, tmp_path, monkeypatch):
    with open_session() as session:
        session.scalar(select(Calibration).where(Calibration.is_active)).version = "files-sha256:other"
        session.commit()
    other = tmp_path / "other.pt"
    other.write_bytes(b"other weights")
    monkeypatch.setenv("PARKMAP_SEGMENTATION_MODEL_PATH", str(other))

    message = verify(seeded_setup)
    assert "active calibration of sripatum-near-lot differs" in message
    assert "are not the pinned yolo11m-seg.pt" in message


def test_an_older_schema_is_reported_before_anything_else(seeded_setup):
    migrate("downgrade", REVISION)

    head = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini"))).get_current_head()
    assert verify(seeded_setup).endswith(f"database schema is at {REVISION}, expected {head}; run alembic upgrade head")
    migrate("upgrade", "head")
