import assert from 'node:assert/strict';
import test from 'node:test';
import { imageNormalizedToGroundMeters, transformParkingCalibration, transformPolygon } from './groundPlaneHomography.ts';
import type { ParkingCalibration } from '../types/calibration.ts';

const matrix = [[2, 0, 1], [0, 3, 2], [0, 0, 1]];
void test('transforms normalized image coordinates into ground meters', () => assert.deepEqual(imageNormalizedToGroundMeters(.25, .5, matrix), { x_m: 1.5, y_m: 3.5 }));
void test('returns invalid for unsafe homogeneous division', () => assert.equal(imageNormalizedToGroundMeters(1, 0, [[1, 0, 0], [0, 1, 0], [1, 0, -1]]), null));
void test('transforms ROI and row polygons without changing source geometry', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const rows: ParkingCalibration['rows'] = [1, 2, 3, 4, 5].map((index) => ({ id: `row_${index}` as ParkingCalibration['rows'][number]['id'], name: `Parking Row ${index}` as ParkingCalibration['rows'][number]['name'], polygon }));
  const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'CAM', reference_image: { width: 100, height: 100 }, parking_roi: { polygon }, rows };
  const snapshot = structuredClone(calibration);
  const result = transformParkingCalibration(calibration, matrix);
  assert.equal(result.roi?.length, 4);
  assert.equal(result.rows.length, 5);
  assert.deepEqual(calibration, snapshot);
});
void test('polygon transform rejects any invalid vertex', () => assert.equal(transformPolygon([{ x: 1, y: 0 }], [[1, 0, 0], [0, 1, 0], [1, 0, -1]]), null));
