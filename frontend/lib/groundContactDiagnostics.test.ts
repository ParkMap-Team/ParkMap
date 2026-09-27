import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGroundContactDiagnostics, createGroundContactProxy, intersectBboxWithPolygon } from './occupancyDiagnostics.ts';
import type { DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection, DetectionBBox } from '../types/detection.ts';

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: rectangle(0, 0, 1, 1) }, rows: [
  { id: 'row_1', name: 'Parking Row 1', polygon: rectangle(.1, .2, .9, .4) }, { id: 'row_2', name: 'Parking Row 2', polygon: rectangle(.1, .4, .9, .6) }, { id: 'row_3', name: 'Parking Row 3', polygon: rectangle(.1, .65, .9, .7) }, { id: 'row_4', name: 'Parking Row 4', polygon: rectangle(.1, .75, .9, .8) }, { id: 'row_5', name: 'Parking Row 5', polygon: rectangle(.1, .85, .9, .9) },
] };
const bbox: DetectionBBox = { x: .2, y: .1, width: .2, height: .5 };
const detection = (box = bbox): Detection => ({ class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: box });
const assignment = (status: DetectionRowAssignment['status']): DetectionRowAssignment => ({ detection_index: 0, ground_point: { x: .3, y: .6 }, status, row_id: status === 'ASSIGNED' ? 'row_2' : null, matching_rows: status === 'ASSIGNED' ? ['row_2'] : [] });

void test('creates 10% proxy geometry', () => { const result = createGroundContactProxy(bbox, .1); assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.proxy.height - .05) < 1e-12); });
void test('creates 20% proxy geometry', () => { const result = createGroundContactProxy(bbox, .2); assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.proxy.height - .1) < 1e-12); });
void test('creates 30% proxy geometry', () => { const result = createGroundContactProxy(bbox, .3); assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.proxy.height - .15) < 1e-12); });
void test('proxy bottom equals bbox bottom', () => { const result = createGroundContactProxy(bbox, .2); assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.proxy.y + result.proxy.height - (bbox.y + bbox.height)) < 1e-12); });
void test('proxy width equals bbox width', () => { const result = createGroundContactProxy(bbox, .2); assert.equal(result.ok, true); if (result.ok) { assert.equal(result.proxy.x, bbox.x); assert.equal(result.proxy.width, bbox.width); } });
void test('proxy coordinates stay normalized', () => { const result = createGroundContactProxy({ x: .8, y: .7, width: .2, height: .3 }, .3); assert.equal(result.ok, true); if (result.ok) assert.ok(result.proxy.x >= 0 && result.proxy.y >= 0 && result.proxy.x + result.proxy.width <= 1 && result.proxy.y + result.proxy.height <= 1); });
void test('malformed bbox is rejected', () => assert.deepEqual(createGroundContactProxy({ ...bbox, width: Number.NaN }, .2), { ok: false, error: 'MALFORMED_BBOX' }));
void test('zero-area bbox is rejected', () => assert.deepEqual(createGroundContactProxy({ ...bbox, height: 0 }, .2), { ok: false, error: 'MALFORMED_BBOX' }));
void test('height ratio at or below zero is rejected', () => { assert.deepEqual(createGroundContactProxy(bbox, 0), { ok: false, error: 'INVALID_HEIGHT_RATIO' }); assert.deepEqual(createGroundContactProxy(bbox, -.1), { ok: false, error: 'INVALID_HEIGHT_RATIO' }); });
void test('height ratio above one is rejected', () => assert.deepEqual(createGroundContactProxy(bbox, 1.1), { ok: false, error: 'INVALID_HEIGHT_RATIO' }));
void test('proxy can be fully inside a row', () => { const proxy = createGroundContactProxy({ x: .2, y: .2, width: .1, height: .2 }, .5); assert.equal(proxy.ok, true); if (proxy.ok) { const overlap = intersectBboxWithPolygon(proxy.proxy, calibration.rows[0].polygon); assert.equal(overlap.ok, true); if (overlap.ok) assert.ok(Math.abs(overlap.bbox_overlap_ratio - 1) < 1e-9); } });
void test('proxy can partially intersect a row', () => { const proxy = createGroundContactProxy({ x: .2, y: .1, width: .1, height: .4 }, .5); assert.equal(proxy.ok, true); if (proxy.ok) { const overlap = intersectBboxWithPolygon(proxy.proxy, calibration.rows[0].polygon); assert.equal(overlap.ok, true); if (overlap.ok) assert.ok(overlap.bbox_overlap_ratio > 0 && overlap.bbox_overlap_ratio < 1); } });
void test('proxy can remain outside a row', () => { const proxy = createGroundContactProxy({ x: .2, y: 0, width: .1, height: .1 }, .2); assert.equal(proxy.ok, true); if (proxy.ok) { const overlap = intersectBboxWithPolygon(proxy.proxy, calibration.rows[0].polygon); assert.equal(overlap.ok, true); if (overlap.ok) assert.equal(overlap.intersects, false); } });
void test('proxy can intersect two rows', () => { const result = buildGroundContactDiagnostics([detection({ x: .2, y: .3, width: .1, height: .2 })], [assignment('UNASSIGNED')], calibration, .5); assert.deepEqual(result.detections[0].intersecting_rows.map((row) => row.row_id), ['row_1', 'row_2']); });
void test('primary assignment is not modified by proxy overlap', () => { const input = assignment('ASSIGNED'); const result = buildGroundContactDiagnostics([detection()], [input], calibration, .2); assert.deepEqual(result.detections[0].primary_assignment, { status: 'ASSIGNED', row_id: 'row_2' }); });
void test('UNASSIGNED remains UNASSIGNED', () => { const result = buildGroundContactDiagnostics([detection()], [assignment('UNASSIGNED')], calibration, .2); assert.equal(result.detections[0].primary_assignment.status, 'UNASSIGNED'); assert.equal(result.detections[0].primary_assignment.row_id, null); });
void test('OUTSIDE_ROI remains OUTSIDE_ROI', () => { const result = buildGroundContactDiagnostics([detection()], [assignment('OUTSIDE_ROI')], calibration, .2); assert.equal(result.detections[0].primary_assignment.status, 'OUTSIDE_ROI'); });
void test('input bbox is not mutated', () => { const input = { ...bbox }; const before = JSON.stringify(input); createGroundContactProxy(input, .2); assert.equal(JSON.stringify(input), before); });
void test('calibration is not mutated', () => { const before = JSON.stringify(calibration); buildGroundContactDiagnostics([detection()], [assignment('ASSIGNED')], calibration, .2); assert.equal(JSON.stringify(calibration), before); });
