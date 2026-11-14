import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
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
