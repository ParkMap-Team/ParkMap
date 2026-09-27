import { deriveRowCenterline } from './rowProjection.ts';
import type { CalibrationPoint, ParkingCalibration } from '../types/calibration.ts';

export interface RoiBounds { min_x: number; max_x: number; min_y: number; max_y: number; width: number; height: number; }

export function calculateRoiBounds(polygon: CalibrationPoint[]): RoiBounds | null {
  if (!polygon.length || !polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const xs = polygon.map((point) => point.x), ys = polygon.map((point) => point.y);
  const min_x = Math.min(...xs), max_x = Math.max(...xs), min_y = Math.min(...ys), max_y = Math.max(...ys);
  if (max_x <= min_x || max_y <= min_y) return null;
  return { min_x, max_x, min_y, max_y, width: max_x - min_x, height: max_y - min_y };
}

export function imageNormalizedToRoiLocal(point: CalibrationPoint, bounds: RoiBounds): CalibrationPoint {
  return { x: (point.x - bounds.min_x) / bounds.width, y: (point.y - bounds.min_y) / bounds.height };
}

export function calibratedRowCenter(polygon: CalibrationPoint[]): CalibrationPoint | null {
  const result = deriveRowCenterline(polygon);
  return result.ok ? { x: (result.centerline.start.x + result.centerline.end.x) / 2, y: (result.centerline.start.y + result.centerline.end.y) / 2 } : null;
}

export function buildHybridLayout(calibration: ParkingCalibration) {
  const bounds = calculateRoiBounds(calibration.parking_roi.polygon);
  if (!bounds) return null;
  return {
    roi_polygon: calibration.parking_roi.polygon.map((point) => imageNormalizedToRoiLocal(point, bounds)),
    rows: calibration.rows.flatMap((row) => {
      const centerline = deriveRowCenterline(row.polygon);
      const center = calibratedRowCenter(row.polygon);
      if (!center) return [];
      return [{ row_id: row.id, polygon: row.polygon.map((point) => imageNormalizedToRoiLocal(point, bounds)), center: imageNormalizedToRoiLocal(center, bounds), centerline: centerline.ok ? { start: imageNormalizedToRoiLocal(centerline.centerline.start, bounds), end: imageNormalizedToRoiLocal(centerline.centerline.end, bounds) } : null }];
    }),
  };
}
