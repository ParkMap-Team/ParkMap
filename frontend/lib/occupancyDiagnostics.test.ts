import assert from 'node:assert/strict';
import test from 'node:test';
import { bboxToPolygon, buildOutsideRoiProxyDiagnostics, buildVisualOccupancyDiagnostics, intersectBboxWithPolygon } from './occupancyDiagnostics.ts';
import type { DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection, DetectionBBox } from '../types/detection.ts';

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const calibration: ParkingCalibration = {
  schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: rectangle(.05, .05, .95, .95) },
  rows: [
    { id: 'row_1', name: 'Parking Row 1', polygon: rectangle(.1, .2, .9, .4) },
    { id: 'row_2', name: 'Parking Row 2', polygon: rectangle(.1, .4, .9, .6) },
    { id: 'row_3', name: 'Parking Row 3', polygon: rectangle(.1, .65, .9, .7) },
    { id: 'row_4', name: 'Parking Row 4', polygon: rectangle(.1, .75, .9, .8) },
    { id: 'row_5', name: 'Parking Row 5', polygon: rectangle(.1, .85, .9, .9) },
  ],
};
const detection = (bbox: DetectionBBox): Detection => ({ class_id: 0, class_name: 'motorcycle', confidence: .9, bbox });
const assignment = (status: DetectionRowAssignment['status'], index = 0): DetectionRowAssignment => ({ detection_index: index, ground_point: { x: .5, y: .5 }, status, row_id: status === 'ASSIGNED' ? 'row_1' : null, matching_rows: status === 'ASSIGNED' ? ['row_1'] : [] });

void test('bbox fully inside a row has full bbox overlap', () => {
  const result = intersectBboxWithPolygon({ x: .2, y: .25, width: .1, height: .1 }, calibration.rows[0].polygon);
  assert.equal(result.ok, true); if (result.ok) assert.ok(Math.abs(result.bbox_overlap_ratio - 1) < 1e-9);
});
void test('partially overlapping bbox returns raw partial area and ratio', () => {
  const result = intersectBboxWithPolygon({ x: .2, y: .35, width: .1, height: .1 }, calibration.rows[0].polygon);
  assert.equal(result.ok, true); if (result.ok) { assert.ok(Math.abs(result.intersection_area_normalized - .005) < 1e-9); assert.ok(Math.abs(result.bbox_overlap_ratio - .5) < 1e-9); }
});
void test('bbox touching a row boundary intersects with zero area', () => {
  const result = intersectBboxWithPolygon({ x: .2, y: .1, width: .1, height: .1 }, calibration.rows[0].polygon);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.intersects, true); assert.equal(result.intersection_area_normalized, 0); }
});
void test('bbox outside row does not intersect', () => {
  const result = intersectBboxWithPolygon({ x: .2, y: .05, width: .1, height: .1 }, calibration.rows[0].polygon);
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.intersects, false);
});
void test('bbox can visually overlap two rows', () => {
  const result = buildVisualOccupancyDiagnostics([detection({ x: .2, y: .35, width: .1, height: .1 })], [assignment('UNASSIGNED')], calibration);
  assert.deepEqual(result.detections[0].intersecting_rows.map((row) => row.row_id), ['row_1', 'row_2']);
});
void test('bbox inside ROI but outside all rows has no row overlaps', () => {
  const result = buildVisualOccupancyDiagnostics([detection({ x: .2, y: .1, width: .05, height: .05 })], [assignment('UNASSIGNED')], calibration);
  assert.equal(result.detections[0].bbox_intersects_parking_roi, true); assert.equal(result.detections[0].intersecting_rows.length, 0);
});
void test('unassigned motorcycle can overlap one row without reassignment', () => {
  const result = buildVisualOccupancyDiagnostics([detection({ x: .2, y: .25, width: .1, height: .1 })], [assignment('UNASSIGNED')], calibration);
  assert.equal(result.detections[0].primary_assignment.status, 'UNASSIGNED'); assert.equal(result.unassigned_with_visual_row_overlap, 1);
});
void test('unassigned motorcycle can overlap multiple rows', () => {
  const result = buildVisualOccupancyDiagnostics([detection({ x: .2, y: .35, width: .1, height: .1 })], [assignment('UNASSIGNED')], calibration);
  assert.equal(result.detections[0].primary_assignment.row_id, null); assert.equal(result.visually_overlapping_multiple_rows, 1);
});
void test('outside ROI primary assignment remains unchanged for partial bbox intersection', () => {
  const result = buildVisualOccupancyDiagnostics([detection({ x: .2, y: 0, width: .1, height: .1 })], [assignment('OUTSIDE_ROI')], calibration);
  assert.equal(result.detections[0].primary_assignment.status, 'OUTSIDE_ROI'); assert.equal(result.detections[0].bbox_intersects_parking_roi, true);
});
void test('outside diagnostic counts external obstructions per intersected row without changing assignment', () => { const assignments = [assignment('OUTSIDE_ROI')]; const result = buildOutsideRoiProxyDiagnostics([detection({ x: .2, y: .1, width: .1, height: .2 })], assignments, calibration); assert.equal(result.external_obstructions_created, 1); assert.equal(result.external_obstructions_by_row.row_1, 1); assert.equal(assignments[0].status, 'OUTSIDE_ROI'); });
void test('rejects malformed bbox', () => assert.deepEqual(bboxToPolygon({ x: .2, y: .2, width: Number.NaN, height: .1 }), { ok: false, error: 'MALFORMED_BBOX' }));
void test('rejects zero-area bbox', () => assert.deepEqual(bboxToPolygon({ x: .2, y: .2, width: 0, height: .1 }), { ok: false, error: 'MALFORMED_BBOX' }));
void test('rejects malformed polygon', () => assert.deepEqual(intersectBboxWithPolygon({ x: .2, y: .2, width: .1, height: .1 }, [{ x: 0, y: 0 }, { x: .1, y: .1 }]), { ok: false, error: 'MALFORMED_POLYGON' }));
void test('bbox polygon coordinates remain normalized', () => {
  const result = bboxToPolygon({ x: .8, y: .7, width: .2, height: .3 }); assert.equal(result.ok, true); if (result.ok) assert.ok(result.polygon.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
});
void test('diagnostics do not mutate detection, assignment, or calibration input', () => {
  const detections = [detection({ x: .2, y: .25, width: .1, height: .1 })]; const assignments = [assignment('ASSIGNED')]; const before = JSON.stringify({ detections, assignments, calibration });
  buildVisualOccupancyDiagnostics(detections, assignments, calibration); assert.equal(JSON.stringify({ detections, assignments, calibration }), before);
});
