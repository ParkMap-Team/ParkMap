import type { CalibrationShape } from '../components/setup/CalibrationCanvas.tsx';
import type { ParkingCalibration } from '../types/calibration.ts';

export const DEFAULT_PARKING_SHAPES = [{ id: 'parking_roi', label: 'Parking ROI' }, { id: 'row_1', label: 'R1' }];

export const rowNumber = (id: string) => Number(/^row_([1-9][0-9]*)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);
export const sortRowIds = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => rowNumber(a.id) - rowNumber(b.id) || a.id.localeCompare(b.id));
export const nextRowId = (ids: string[]): `row_${number}` => {
  const used = new Set(ids);
  let number = 1;
  while (used.has(`row_${number}`)) number += 1;
  return `row_${number}`;
};

export function shapesFromCalibration(calibration: ParkingCalibration | null): CalibrationShape[] {
  if (!calibration) return DEFAULT_PARKING_SHAPES.map((shape) => ({ ...shape, points: [] }));
  return [{ id: 'parking_roi', label: 'Parking ROI', points: calibration.parking_roi.polygon }, ...sortRowIds(calibration.rows).map((row) => ({ id: row.id, label: row.id.replace('row_', 'R'), points: row.polygon }))];
}

export function calibrationFromShapes(shapes: CalibrationShape[], cameraId: string, width: number, height: number): ParkingCalibration {
  return { schema_version: 2, camera_id: cameraId, reference_image: { width, height }, parking_roi: { polygon: shapes[0].points }, rows: sortRowIds(shapes.slice(1)).map((shape) => ({ id: shape.id as ParkingCalibration['rows'][number]['id'], name: `Parking Row ${rowNumber(shape.id)}`, polygon: shape.points })) };
}
