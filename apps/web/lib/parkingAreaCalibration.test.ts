import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationFromShapes, nextRowId, shapesFromCalibration, sortRowIds } from './parkingAreaCalibration.ts';
import type { ParkingCalibration } from '../types/calibration.ts';

const polygon = [{ x: .1, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .7 }, { x: .1, y: .7 }];
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'CAM', reference_image: { width: 1000, height: 800 }, parking_roi: { polygon }, rows: Array.from({ length: 5 }, (_, index) => ({ id: `row_${index + 1}` as ParkingCalibration['rows'][number]['id'], name: `Parking Row ${index + 1}` as ParkingCalibration['rows'][number]['name'], polygon: polygon.map((point) => ({ ...point, y: point.y + index * .01 })) })) };

void test('ROI and R1-R5 editor load saved canonical geometry', () => {
  const shapes = shapesFromCalibration(calibration);
  assert.deepEqual(shapes[0].points, calibration.parking_roi.polygon);
  assert.equal(shapes.length, 6);
  assert.deepEqual(shapes.slice(1).map((shape) => shape.points), calibration.rows.map((row) => row.polygon));
});

void test('new editor starts with one row and lets the user add more', () => {
  const shapes = shapesFromCalibration(null);
  assert.deepEqual(shapes.map((shape) => shape.id), ['parking_roi', 'row_1']);
});

void test('ROI and R1-R5 editor save back to the single canonical format', () => {
  const shapes = shapesFromCalibration(calibration);
  shapes[0] = { ...shapes[0], points: [...polygon, { x: .2, y: .8 }] };
  const saved = calibrationFromShapes(shapes, 'CAM', 1000, 800);
  assert.deepEqual(saved.parking_roi.polygon, shapes[0].points);
  assert.deepEqual(saved.rows.map((row) => row.polygon), shapes.slice(1).map((shape) => shape.points));
  assert.deepEqual(saved.rows.map((row) => row.id), ['row_1', 'row_2', 'row_3', 'row_4', 'row_5']);
});

void test('supports more than five rows and numeric row ordering', () => {
  const dynamic = { ...calibration, rows: [1, 10, 2, 8, 3, 4, 5, 6].map((number) => ({ id: `row_${number}` as const, name: `Parking Row ${number}`, polygon })) };
  assert.deepEqual(shapesFromCalibration(dynamic).slice(1).map((shape) => shape.id), ['row_1', 'row_2', 'row_3', 'row_4', 'row_5', 'row_6', 'row_8', 'row_10']);
  assert.deepEqual(sortRowIds(dynamic.rows).map((row) => row.id), ['row_1', 'row_2', 'row_3', 'row_4', 'row_5', 'row_6', 'row_8', 'row_10']);
});

void test('generates the lowest unused stable row ID', () => {
  assert.equal(nextRowId(['row_1', 'row_2', 'row_4', 'row_5']), 'row_3');
  assert.equal(nextRowId(['row_1', 'row_2', 'row_3', 'row_4', 'row_5']), 'row_6');
});
