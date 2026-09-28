import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationFromShapes, shapesFromCalibration } from './parkingAreaCalibration.ts';
import type { ParkingCalibration } from '../types/calibration.ts';

const polygon = [{ x: .1, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .7 }, { x: .1, y: .7 }];
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'CAM', reference_image: { width: 1000, height: 800 }, parking_roi: { polygon }, rows: Array.from({ length: 5 }, (_, index) => ({ id: `row_${index + 1}` as ParkingCalibration['rows'][number]['id'], name: `Parking Row ${index + 1}` as ParkingCalibration['rows'][number]['name'], polygon: polygon.map((point) => ({ ...point, y: point.y + index * .01 })) })) };

void test('ROI and R1-R5 editor load saved canonical geometry', () => {
  const shapes = shapesFromCalibration(calibration);
  assert.deepEqual(shapes[0].points, calibration.parking_roi.polygon);
  assert.equal(shapes.length, 6);
  assert.deepEqual(shapes.slice(1).map((shape) => shape.points), calibration.rows.map((row) => row.polygon));
});

void test('ROI and R1-R5 editor save back to the single canonical format', () => {
  const shapes = shapesFromCalibration(calibration);
  shapes[0] = { ...shapes[0], points: [...polygon, { x: .2, y: .8 }] };
  const saved = calibrationFromShapes(shapes, 'CAM', 1000, 800);
  assert.deepEqual(saved.parking_roi.polygon, shapes[0].points);
  assert.deepEqual(saved.rows.map((row) => row.polygon), shapes.slice(1).map((shape) => shape.points));
  assert.deepEqual(saved.rows.map((row) => row.id), ['row_1', 'row_2', 'row_3', 'row_4', 'row_5']);
});
