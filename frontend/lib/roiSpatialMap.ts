import { buildOutsideRoiProxyDiagnostics } from './occupancyDiagnostics.ts';
import type { CalibrationPoint, DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { RoiSpatialMapData, RoiViewport } from '../types/roiSpatialMap.ts';

export function calculateRoiViewport(polygon: CalibrationPoint[], paddingRatio = .04): RoiViewport {
  const xs = polygon.map((point) => point.x), ys = polygon.map((point) => point.y);
  const rawMinX = Math.min(...xs), rawMaxX = Math.max(...xs), rawMinY = Math.min(...ys), rawMaxY = Math.max(...ys);
  const padX = (rawMaxX - rawMinX) * paddingRatio, padY = (rawMaxY - rawMinY) * paddingRatio;
  const min_x = Math.max(0, rawMinX - padX), max_x = Math.min(1, rawMaxX + padX), min_y = Math.max(0, rawMinY - padY), max_y = Math.min(1, rawMaxY + padY);
  return { min_x, max_x, min_y, max_y, width: max_x - min_x, height: max_y - min_y };
}

export function toRoiLocal(point: CalibrationPoint, viewport: RoiViewport): CalibrationPoint {
  return { x: (point.x - viewport.min_x) / viewport.width, y: (point.y - viewport.min_y) / viewport.height };
}

export function buildRoiSpatialMapData(detections: Detection[], assignments: DetectionRowAssignment[], calibration: ParkingCalibration): RoiSpatialMapData {
  return { map_mode: 'IMAGE_NORMALIZED', parking_roi: calibration.parking_roi.polygon.map((point) => ({ ...point })), rows: calibration.rows.map((row) => ({ id: row.id, name: row.name, polygon: row.polygon.map((point) => ({ ...point })) })), viewport: calculateRoiViewport(calibration.parking_roi.polygon), assignments: assignments.map((item) => ({ ...item, ground_point: { ...item.ground_point }, matching_rows: [...item.matching_rows] })), outside_roi_diagnostics: buildOutsideRoiProxyDiagnostics(detections, assignments, calibration) };
}
