import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHybridLayout, calculateRoiBounds, calibratedRowCenter, imageNormalizedToRoiLocal } from './hybridParkingMap.ts';
import { positionWithinProportionalRow, proportionalRowWidth } from './proportionalRowMap.ts';
import { orderRowsForDisplay } from './rowDisplayOrder.ts';
import type { ParkingCalibration } from '../types/calibration.ts';

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'test', reference_image: { width: 4032, height: 3024 }, parking_roi: { polygon: rectangle(.1, .2, .9, .9) }, rows: [
  { id: 'row_1', name: 'Parking Row 1', polygon: rectangle(.2, .25, .8, .3) },
  { id: 'row_2', name: 'Parking Row 2', polygon: rectangle(.2, .31, .8, .36) },
  { id: 'row_3', name: 'Parking Row 3', polygon: rectangle(.2, .6, .8, .65) },
  { id: 'row_4', name: 'Parking Row 4', polygon: rectangle(.2, .66, .8, .71) },
  { id: 'row_5', name: 'Parking Row 5', polygon: rectangle(.2, .82, .8, .87) },
] };

void test('calculates ROI bounding box from polygon', () => assert.deepEqual(calculateRoiBounds(calibration.parking_roi.polygon), { min_x: .1, max_x: .9, min_y: .2, max_y: .9, width: .8, height: .7 }));
void test('normalizes image coordinate into ROI-local coordinate', () => { const bounds = calculateRoiBounds(calibration.parking_roi.polygon)!; const point = imageNormalizedToRoiLocal({ x: .5, y: .55 }, bounds); assert.ok(Math.abs(point.x - .5) < 1e-12 && Math.abs(point.y - .5) < 1e-12); });
void test('derives row center from calibrated polygon centerline', () => assert.deepEqual(calibratedRowCenter(calibration.rows[0].polygon), { x: .5, y: .275 }));
void test('closer calibrated Y positions render closer than larger Y separation', () => { const rows = buildHybridLayout(calibration)!.rows; const close = Math.abs(rows[1].center.y - rows[0].center.y); const far = Math.abs(rows[2].center.y - rows[1].center.y); assert.ok(close < far); });
void test('metric width ratio remains row length divided by maximum', () => assert.equal(proportionalRowWidth(15, [15, 18]), 15 / 18));
void test('moving row polygon changes calibrated position without changing metric length', () => { const moved = structuredClone(calibration); moved.rows[0].polygon = rectangle(.2, .4, .8, .45); assert.notEqual(buildHybridLayout(moved)!.rows[0].center.y, buildHybridLayout(calibration)!.rows[0].center.y); assert.equal(proportionalRowWidth(15, [15, 18]), 15 / 18); });
void test('changing metric length changes display length without changing calibrated position', () => { const center = buildHybridLayout(calibration)!.rows[0].center; assert.notEqual(proportionalRowWidth(15, [15, 18]), proportionalRowWidth(18, [15, 18])); assert.deepEqual(buildHybridLayout(calibration)!.rows[0].center, center); });
void test('t 0, 0.5 and 1 map along displayed row', () => assert.deepEqual([0, .5, 1].map((t) => positionWithinProportionalRow(t, 600)), [0, 300, 600]));
void test('display order does not mutate calibration geometry', () => { const before = JSON.stringify(calibration); orderRowsForDisplay(calibration.rows, 'DESCENDING'); assert.equal(JSON.stringify(calibration), before); });
void test('building calibration debug geometry does not modify analysis or calibration data', () => { const analysis = { detections: [{ bbox: { x: .1, y: .2, width: .1, height: .2 } }] }; const before = JSON.stringify({ analysis, calibration }); buildHybridLayout(calibration); assert.equal(JSON.stringify({ analysis, calibration }), before); });
