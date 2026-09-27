import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRowOccupancyProjection, deriveRowCenterline, projectPointOntoRow } from './rowProjection.ts';
import type { CalibrationPoint, DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';

const horizontal: CalibrationPoint[] = [{ x: .1, y: .2 }, { x: .9, y: .2 }, { x: .9, y: .4 }, { x: .1, y: .4 }];
const detection: Detection = { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .1, y: .1, width: .1, height: .1 } };
const row = (polygon = horizontal): ParkingCalibration => ({ schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: horizontal }, rows: [{ id: 'row_1', name: 'Parking Row 1', polygon }] });
const assigned = (index: number, x: number, y = .3): DetectionRowAssignment => ({ detection_index: index, ground_point: { x, y }, status: 'ASSIGNED', row_id: 'row_1', matching_rows: ['row_1'] });

void test('derives horizontal row centerline from longer opposite edges', () => {
  const result = deriveRowCenterline(horizontal);
  assert.deepEqual(result, { ok: true, centerline: { start: { x: .1, y: .30000000000000004 }, end: { x: .9, y: .30000000000000004 } } });
});

void test('derives a slanted row centerline', () => {
  const result = deriveRowCenterline([{ x: .1, y: .2 }, { x: .8, y: .4 }, { x: .75, y: .6 }, { x: .05, y: .4 }]);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.centerline, { start: { x: .07500000000000001, y: .30000000000000004 }, end: { x: .775, y: .5 } });
});

void test('canonical direction survives cyclic rotation', () => {
  assert.deepEqual(deriveRowCenterline(horizontal), deriveRowCenterline([...horizontal.slice(2), ...horizontal.slice(0, 2)]));
});

void test('canonical direction survives reversed boundary order', () => {
  assert.deepEqual(deriveRowCenterline(horizontal), deriveRowCenterline([...horizontal].reverse()));
});

void test('projects at start, middle and end', () => {
  const line = { start: { x: .1, y: .3 }, end: { x: .9, y: .3 } };
  const start = projectPointOntoRow({ x: .1, y: .3 }, line);
  const middle = projectPointOntoRow({ x: .5, y: .4 }, line);
  const end = projectPointOntoRow({ x: .9, y: .3 }, line);
  assert.equal(start.ok && start.row_position.t, 0);
  assert.equal(middle.ok && middle.row_position.t, .5);
  assert.equal(end.ok && end.row_position.t, 1);
});

void test('clamps points before start while preserving negative t_raw', () => {
  const result = projectPointOntoRow({ x: 0, y: .3 }, { start: { x: .1, y: .3 }, end: { x: .9, y: .3 } });
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.row_position.t, 0); assert.ok(result.row_position.t_raw < 0); }
});

void test('clamps points after end while preserving t_raw above one', () => {
  const result = projectPointOntoRow({ x: 1, y: .3 }, { start: { x: .1, y: .3 }, end: { x: .9, y: .3 } });
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.row_position.t, 1); assert.ok(result.row_position.t_raw > 1); }
});

void test('reports normalized perpendicular distance', () => {
  const result = projectPointOntoRow({ x: .5, y: .5 }, { start: { x: .1, y: .3 }, end: { x: .9, y: .3 } });
  assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.row_position.distance_to_centerline - .2) < 1e-12);
});

void test('groups and sorts motorcycles by t', () => {
  const result = buildRowOccupancyProjection([detection, detection], [assigned(0, .7), assigned(1, .2)], row());
  assert.deepEqual(result.rows[0].motorcycles.map((item) => item.detection_index), [1, 0]);
});

void test('uses detection index to break equal-position ties', () => {
  const result = buildRowOccupancyProjection([detection, detection], [assigned(1, .5), assigned(0, .5)], row());
  assert.deepEqual(result.rows[0].motorcycles.map((item) => item.detection_index), [0, 1]);
});

void test('keeps unassigned separate from row positions', () => {
  const assignment: DetectionRowAssignment = { ...assigned(0, .5), status: 'UNASSIGNED', row_id: null, matching_rows: [] };
  const result = buildRowOccupancyProjection([detection], [assignment], row()); assert.equal(result.unassigned.length, 1); assert.equal(result.rows[0].motorcycles.length, 0);
});

void test('keeps ambiguous separate from row positions', () => {
  const assignment: DetectionRowAssignment = { ...assigned(0, .5), status: 'AMBIGUOUS', row_id: null };
  const result = buildRowOccupancyProjection([detection], [assignment], row()); assert.equal(result.ambiguous.length, 1); assert.equal(result.rows[0].motorcycles.length, 0);
});

void test('keeps outside ROI separate from row positions', () => {
  const assignment: DetectionRowAssignment = { ...assigned(0, .5), status: 'OUTSIDE_ROI', row_id: null, matching_rows: [] };
  const result = buildRowOccupancyProjection([detection], [assignment], row()); assert.equal(result.outside_roi.length, 1); assert.equal(result.rows[0].motorcycles.length, 0);
});

void test('does not mutate calibration or assignments', () => {
  const calibration = row(); const assignments = [assigned(0, .4)]; const detections = [{ ...detection, bbox: { ...detection.bbox } }]; const before = JSON.stringify({ calibration, assignments, detections });
  buildRowOccupancyProjection(detections, assignments, calibration); assert.equal(JSON.stringify({ calibration, assignments, detections }), before);
});

void test('rejects polygons with fewer than four points', () => assert.deepEqual(deriveRowCenterline(horizontal.slice(0, 3)), { ok: false, error: 'UNSUPPORTED_VERTEX_COUNT' }));
void test('rejects polygons with more than four points', () => assert.deepEqual(deriveRowCenterline([...horizontal, { x: .5, y: .5 }]), { ok: false, error: 'UNSUPPORTED_VERTEX_COUNT' }));
void test('rejects malformed zero-area polygons', () => assert.deepEqual(deriveRowCenterline([{ x: 0, y: 0 }, { x: .2, y: 0 }, { x: .4, y: 0 }, { x: .6, y: 0 }]), { ok: false, error: 'MALFORMED_POLYGON' }));
void test('rejects a zero-length centerline', () => assert.deepEqual(projectPointOntoRow({ x: .5, y: .5 }, { start: { x: .5, y: .5 }, end: { x: .5, y: .5 } }), { ok: false, error: 'ZERO_LENGTH_CENTERLINE' }));
void test('returns normalized projection coordinates', () => {
  const result = projectPointOntoRow({ x: .5, y: .8 }, { start: { x: .1, y: .2 }, end: { x: .9, y: .6 } });
  assert.equal(result.ok, true); if (result.ok) { assert.ok(result.row_position.projection.x >= 0 && result.row_position.projection.x <= 1); assert.ok(result.row_position.projection.y >= 0 && result.row_position.projection.y <= 1); }
});
