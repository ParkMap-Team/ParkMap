from pathlib import Path

from shapely.geometry import Polygon
from sqlalchemy.orm import Session

from app.db import repository
from app.models import GroundPlaneCalibration, LotModelDefinition, ParkingCalibration
from app.services.ground_plane_homography_service import (
    GroundPlaneHomographyService,
    transform_point,
)
from app.services.live_state_service import calibration_version
from app.services.lot_model_editor_service import validate_site_definition
from app.services.lot_placement_service import (
    placement_for_calibration,
    replace_calibration_roi,
)

CONFIG_DIRECTORY = Path(__file__).resolve().parents[2] / "config"


def preview_calibration_roi(session: Session, site_id: str, definition: LotModelDefinition,
    directory: Path = CONFIG_DIRECTORY) -> LotModelDefinition:
    """Read current calibration and preview a replacement; never persist or activate."""
    validate_site_definition(session, site_id, definition)
    try:
        version = calibration_version(directory)
        ground = GroundPlaneCalibration.model_validate_json((directory / "ground_plane_calibration.json").read_bytes())
        parking = ParkingCalibration.model_validate_json((directory / "parking_calibration.json").read_bytes())
        response = GroundPlaneHomographyService(directory).get_response(ground)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError("Calibration is unavailable; save and calculate it first") from error
    if not response.current or response.status != "VALIDATED" or response.result is None or ground.camera_id != parking.camera_id:
        raise ValueError("Save and validate the current camera calibration before importing its ROI")
    area = next((area for area in repository.site_areas(session, site_id) if area.camera_id == parking.camera_id), None)
    if area is None:
        raise ValueError("The saved calibration camera does not belong to this site")
    target = next((item for item in definition.parking_areas if item.parking_area_id == area.id), None)
    active = repository.active_calibrations(session, [area.id]).get(area.id)
    placement = placement_for_calibration(active.payload, target.polygon) if active and target else None
    if placement is None:
        raise ValueError("Cannot preserve this ROI placement; load the active lot model before importing calibration")
    projected = [transform_point(point.x, point.y, response.result.matrix) for point in parking.parking_roi.polygon]
    expected = Polygon([(p.x_m, p.y_m) for p in response.result.roi_metric.points])
    if any(point is None for point in projected) or not expected.is_valid:
        raise ValueError("Invalid current ROI projection")
    current = Polygon(projected)
    if not current.is_valid or current.symmetric_difference(expected).area > 1e-6:
        raise ValueError("Camera ROI changed; recalculate calibration before importing")
    result = replace_calibration_roi(definition, area.id, response.result.roi_metric.points, placement)
    validate_site_definition(session, site_id, result)
    if calibration_version(directory) != version:
        raise ValueError("Calibration changed during import; try again")
    return result
