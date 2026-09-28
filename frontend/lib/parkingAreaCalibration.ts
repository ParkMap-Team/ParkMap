import type { CalibrationShape } from '../components/setup/CalibrationCanvas.tsx';
import type { ParkingCalibration } from '../types/calibration.ts';

export const PARKING_SHAPES = [{ id: 'parking_roi', label: 'Parking ROI' }, ...Array.from({ length: 5 }, (_, index) => ({ id: `row_${index + 1}`, label: `R${index + 1}` }))];

export function shapesFromCalibration(calibration: ParkingCalibration | null): CalibrationShape[] {
  return PARKING_SHAPES.map((definition, index) => ({ ...definition, points: index === 0 ? calibration?.parking_roi.polygon ?? [] : calibration?.rows[index - 1]?.polygon ?? [] }));
}

export function calibrationFromShapes(shapes: CalibrationShape[], cameraId: string, width: number, height: number): ParkingCalibration {
  return { schema_version: 2, camera_id: cameraId, reference_image: { width, height }, parking_roi: { polygon: shapes[0].points }, rows: shapes.slice(1).map((shape, index) => ({ id: `row_${index + 1}` as ParkingCalibration['rows'][number]['id'], name: `Parking Row ${index + 1}` as ParkingCalibration['rows'][number]['name'], polygon: shape.points })) };
}
