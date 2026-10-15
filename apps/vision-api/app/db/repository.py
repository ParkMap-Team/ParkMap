from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session

from app.db.tables import Calibration, LotModel, ParkingArea, ParkingState, Site
from app.models import LotModelDefinition, ParkingStatePublish


def list_sites(session: Session) -> list[Site]:
    return list(session.scalars(select(Site).order_by(Site.id)))


def site_areas(session: Session, site_id: str) -> list[ParkingArea]:
    return list(session.scalars(select(ParkingArea).where(ParkingArea.site_id == site_id).order_by(ParkingArea.id)))


def active_lot_model(session: Session, site_id: str) -> LotModel | None:
    return session.scalar(select(LotModel).where(LotModel.site_id == site_id, LotModel.is_active))


def active_calibration_versions(session: Session, area_ids: list[str]) -> dict[str, str]:
    rows = session.execute(select(Calibration.parking_area_id, Calibration.version).where(Calibration.parking_area_id.in_(area_ids), Calibration.is_active))
    return {area_id: version for area_id, version in rows}


def latest_states(session: Session, area_ids: list[str]) -> dict[str, ParkingStatePublish]:
    query = (
        select(ParkingState)
        .where(ParkingState.parking_area_id.in_(area_ids))
        .ext(distinct_on(ParkingState.parking_area_id))
        .order_by(ParkingState.parking_area_id, ParkingState.processed_at.desc())
    )
    return {row.parking_area_id: ParkingStatePublish.model_validate(row.payload) for row in session.scalars(query)}


def insert_state(session: Session, publish: ParkingStatePublish) -> None:
    session.add(
        ParkingState(
            parking_area_id=publish.parking_area_id,
            observed_at=publish.observed_at,
            processed_at=publish.processed_at,
            calibration_version=publish.calibration_version,
            payload=publish.model_dump(mode="json"),
        )
    )


def create_site(session: Session, site_id: str, name: str, latitude: float, longitude: float) -> None:
    session.add(Site(id=site_id, name=name, latitude=latitude, longitude=longitude))


def create_parking_area(session: Session, area_id: str, site_id: str, camera_id: str, name: str) -> None:
    session.add(ParkingArea(id=area_id, site_id=site_id, camera_id=camera_id, name=name))


def activate_calibration(session: Session, area_id: str, version: str, payload: dict[str, Any]) -> None:
    """Make `version` the only active calibration for the area, inserting it when new."""
    session.execute(update(Calibration).where(Calibration.parking_area_id == area_id, Calibration.is_active).values(is_active=False))
    session.flush()
    existing = session.scalar(select(Calibration).where(Calibration.parking_area_id == area_id, Calibration.version == version))
    if existing is None:
        session.add(Calibration(parking_area_id=area_id, version=version, payload=payload, is_active=True))
    else:
        existing.is_active = True


def activate_lot_model(session: Session, site_id: str, definition: LotModelDefinition) -> int:
    """Store the definition as the next version for the site and make it the only active one."""
    version = (session.scalar(select(func.max(LotModel.version)).where(LotModel.site_id == site_id)) or 0) + 1
    session.execute(update(LotModel).where(LotModel.site_id == site_id, LotModel.is_active).values(is_active=False))
    session.flush()
    session.add(LotModel(site_id=site_id, version=version, payload=definition.model_dump(mode="json"), is_active=True))
    return version


def purge_states(session: Session, older_than: datetime) -> int:
    result = session.execute(delete(ParkingState).where(ParkingState.processed_at < older_than))
    return result.rowcount or 0


def remove_site(session: Session, site_id: str) -> None:
    """Delete the site with its parking areas, calibrations, lot models, and stored states."""
    area_ids = select(ParkingArea.id).where(ParkingArea.site_id == site_id).scalar_subquery()
    session.execute(delete(ParkingState).where(ParkingState.parking_area_id.in_(area_ids)))
    session.execute(delete(Calibration).where(Calibration.parking_area_id.in_(area_ids)))
    session.execute(delete(ParkingArea).where(ParkingArea.site_id == site_id))
    session.execute(delete(LotModel).where(LotModel.site_id == site_id))
    session.execute(delete(Site).where(Site.id == site_id))
