import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOccupiedIntervalPrototype, calculateOccupiedGaps, mergeOccupiedIntervals, OCCUPIED_INTERVAL_GROUND_PROXY_RATIO, projectIntersectionPolygonToInterval } from './occupiedIntervals.ts';
import type { CalibrationRow, DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { MetricCalibrationResponse } from '../types/metricCalibration.ts';
import type { OccupiedInterval } from '../types/occupiedIntervals.ts';

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const rows: ParkingCalibration['rows'] = [
  { id: 'row_1', name: 'Parking Row 1', polygon: rectangle(.1, .2, .9, .4) },
  { id: 'row_2', name: 'Parking Row 2', polygon: rectangle(.1, .4, .9, .6) },
  { id: 'row_3', name: 'Parking Row 3', polygon: rectangle(.1, .6, .9, .7) },
  { id: 'row_4', name: 'Parking Row 4', polygon: rectangle(.1, .72, .9, .8) },
  { id: 'row_5', name: 'Parking Row 5', polygon: rectangle(.1, .82, .9, .9) },
];
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: rectangle(0, 0, 1, 1) }, rows };
const detection = (x: number, y: number, width: number, height: number): Detection => ({ class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x, y, width, height } });
const assignment = (index: number, status: DetectionRowAssignment['status'], rowId: DetectionRowAssignment['row_id'] = null, matchingRows: DetectionRowAssignment['matching_rows'] = []): DetectionRowAssignment => ({ detection_index: index, ground_point: { x: .5, y: .5 }, status, row_id: rowId, matching_rows: matchingRows });
const metric: MetricCalibrationResponse = { status: 'PARTIALLY_CALIBRATED', measurement_source: 'MEASURED', row_measurements_complete: false, ground_plane_calibration_available: false, calibration: { schema_version: 1, camera_id: 'test', unit: 'meter', measurement_source: 'MEASURED', rows: [{ id: 'row_1', length_m: 8 }], reference_segments: [], ground_control_points: [] } };
const interval = (start: number, end: number, index: number, source: OccupiedInterval['source_type'] = 'ASSIGNED'): OccupiedInterval => ({ row_id: 'row_1', detection_index: index, source_type: source, t_start: start, t_end: end, position_start_m: null, position_end_m: null, metric_source: null });

void test('prototype fixes Ground Proxy height at 20%', () => assert.equal(OCCUPIED_INTERVAL_GROUND_PROXY_RATIO, .2));
void test('projects every intersection vertex and uses min/max t', () => { const result = projectIntersectionPolygonToInterval(rectangle(.3, .22, .7, .38), rows[0], 0, 'ASSIGNED'); assert.equal(result.ok, true); if (result.ok) { assert.ok(Math.abs(result.interval.t_start - .25) < 1e-9); assert.ok(Math.abs(result.interval.t_end - .75) < 1e-9); } });
void test('clamps projected t values to 0..1 only after min/max', () => { const result = projectIntersectionPolygonToInterval(rectangle(0, .22, 1, .38), rows[0], 0, 'ASSIGNED'); assert.equal(result.ok, true); if (result.ok) assert.deepEqual([result.interval.t_start, result.interval.t_end], [0, 1]); });
void test('rejects empty intersection geometry', () => assert.deepEqual(projectIntersectionPolygonToInterval([], rows[0], 0, 'ASSIGNED'), { ok: false, error: 'MISSING_INTERSECTION_VERTICES' }));
void test('reports unsupported row geometry', () => { const bad = { ...rows[0], polygon: rectangle(.1, .2, .9, .4).slice(0, 3) } as CalibrationRow; const result = projectIntersectionPolygonToInterval(rectangle(.2, .2, .3, .3), bad, 0, 'ASSIGNED'); assert.equal(result.ok, false); });
void test('ASSIGNED contributes only to its primary row', () => { const result = buildOccupiedIntervalPrototype([detection(.2, .3, .2, .2)], [assignment(0, 'ASSIGNED', 'row_2', ['row_1', 'row_2'])], calibration); assert.equal(result.rows[0].intervals.length, 0); assert.equal(result.rows[1].intervals[0]?.source_type, 'ASSIGNED'); });
void test('UNASSIGNED creates an obstruction on every intersected row', () => { const result = buildOccupiedIntervalPrototype([detection(.2, .3, .2, .5)], [assignment(0, 'UNASSIGNED')], calibration); const hits = result.rows.filter((row) => row.intervals.length).map((row) => row.row_id); assert.deepEqual(hits, ['row_3', 'row_4']); assert.ok(result.rows.flatMap((row) => row.intervals).every((item) => item.source_type === 'UNASSIGNED_OBSTRUCTION')); });
void test('AMBIGUOUS creates obstructions only on intersected candidate rows', () => { const result = buildOccupiedIntervalPrototype([detection(.2, .3, .2, .5)], [assignment(0, 'AMBIGUOUS', null, ['row_3'])], calibration); assert.equal(result.rows[2].intervals[0]?.source_type, 'AMBIGUOUS_OBSTRUCTION'); assert.equal(result.rows[3].intervals.length, 0); });
void test('OUTSIDE_ROI creates no row interval', () => { const result = buildOccupiedIntervalPrototype([detection(.2, .3, .2, .5)], [assignment(0, 'OUTSIDE_ROI')], calibration); assert.equal(result.rows.flatMap((row) => row.intervals).length, 0); assert.deepEqual(result.ignored.outside_roi, [0]); });
void test('UNASSIGNED without row overlap is tracked without assignment', () => { const result = buildOccupiedIntervalPrototype([detection(.02, .02, .05, .05)], [assignment(0, 'UNASSIGNED')], calibration); assert.deepEqual(result.ignored.unassigned_without_row_overlap, [0]); });
void test('overlapping intervals merge', () => assert.deepEqual(mergeOccupiedIntervals([interval(.1, .4, 1), interval(.3, .6, 2)], 'row_1')[0].detection_indices, [1, 2]));
void test('touching intervals merge within epsilon', () => assert.equal(mergeOccupiedIntervals([interval(.1, .3, 1), interval(.3 + 5e-10, .5, 2)], 'row_1').length, 1));
void test('separated intervals remain separate with no added margin', () => assert.equal(mergeOccupiedIntervals([interval(.1, .3, 1), interval(.31, .5, 2)], 'row_1').length, 2));
void test('merged interval preserves unique sources and detection indices', () => { const result = mergeOccupiedIntervals([interval(.1, .3, 2), interval(.2, .4, 1, 'UNASSIGNED_OBSTRUCTION')], 'row_1')[0]; assert.deepEqual(result.detection_indices, [1, 2]); assert.deepEqual(result.source_types, ['ASSIGNED', 'UNASSIGNED_OBSTRUCTION']); });
void test('empty occupied set produces one full-row gap', () => assert.deepEqual(calculateOccupiedGaps([], 'row_1').map((gap) => [gap.t_start, gap.t_end]), [[0, 1]]));
void test('gap calculation returns complement of merged intervals', () => assert.deepEqual(calculateOccupiedGaps(mergeOccupiedIntervals([interval(.2, .4, 1), interval(.6, .8, 2)], 'row_1'), 'row_1').map((gap) => [gap.t_start, gap.t_end]), [[0, .2], [.4, .6], [.8, 1]]));
void test('full-row occupied interval produces no gap', () => assert.equal(calculateOccupiedGaps(mergeOccupiedIntervals([interval(0, 1, 1)], 'row_1'), 'row_1').length, 0));
void test('metric calibration converts t endpoints and preserves source', () => { const result = buildOccupiedIntervalPrototype([detection(.3, .2, .4, .2)], [assignment(0, 'ASSIGNED', 'row_1', ['row_1'])], calibration, metric).rows[0].intervals[0]; assert.equal(result.metric_source, 'MEASURED'); assert.ok(result.position_start_m !== null && result.position_end_m !== null); });
void test('missing row length leaves all metric values null', () => { const result = buildOccupiedIntervalPrototype([detection(.3, .4, .4, .2)], [assignment(0, 'ASSIGNED', 'row_2', ['row_2'])], calibration, metric).rows[1]; assert.equal(result.intervals[0].position_start_m, null); assert.equal(result.gaps[0]?.gap_length_m ?? null, null); });
void test('inputs are not mutated', () => { const detections = [detection(.3, .2, .4, .2)]; const assignments = [assignment(0, 'ASSIGNED', 'row_1', ['row_1'])]; const before = JSON.stringify({ detections, assignments, calibration, metric }); buildOccupiedIntervalPrototype(detections, assignments, calibration, metric); assert.equal(JSON.stringify({ detections, assignments, calibration, metric }), before); });
