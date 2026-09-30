import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMetricMotorcycleMapping, metricPointInPolygon, parkingMapMotorcycles, parkingMapRoi } from './metricMotorcycle.ts';
import type { DetectionRowAssignment } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { GroundPlaneHomographyResponse } from '../types/groundPlaneCalibration.ts';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry.ts';

const detection: Detection = { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .2, y: .2, width: .2, height: .3 } };
const assignment: DetectionRowAssignment = { detection_index: 0, ground_point: { x: .3, y: .5 }, status: 'ASSIGNED', row_id: 'row_1', matching_rows: ['row_1'] };
const square = [{ x_m: 2, y_m: 4 }, { x_m: 4, y_m: 4 }, { x_m: 4, y_m: 6 }, { x_m: 2, y_m: 6 }];
const homography = { status: 'VALIDATED', current: true, row_validation_current: true, message: 'ready', result: { matrix: [[10, 0, 0], [0, 10, 0], [0, 0, 1]] } } as GroundPlaneHomographyResponse;
const physical = { status: 'CURRENT', rows: Array.from({ length: 5 }, (_, index) => ({ row_id: `row_${index + 1}`, status: 'PHYSICAL_READY', physical_polygon: index === 0 ? square : square.map((p) => ({ x_m: p.x_m + 20 * index, y_m: p.y_m })) })) } as PhysicalRowGeometryResponse;

void test('bbox bottom-center transforms to metric motorcycle point', () => {
  const result = buildMetricMotorcycleMapping([detection], [assignment], homography, physical).motorcycles[0];
  assert.ok(Math.abs(result.image_ground_point.x - .3) < 1e-12);
  assert.equal(result.image_ground_point.y, .5);
  assert.ok(Math.abs(result.metric_point!.x_m - 3) < 1e-12);
  assert.equal(result.metric_point!.y_m, 5);
  assert.equal(result.transform_valid, true);
});

void test('invalid homography produces invalid metric point', () => {
  const invalid = { ...homography, current: false };
  const result = buildMetricMotorcycleMapping([detection], [assignment], invalid, physical);
  assert.equal(result.status, 'CALIBRATION_REQUIRED');
  assert.equal(result.motorcycles[0].transform_valid, false);
});

void test('physical containment supports inside, outside and multiple rows', () => {
  assert.equal(metricPointInPolygon({ x_m: 3, y_m: 5 }, square), true);
  assert.equal(metricPointInPolygon({ x_m: 9, y_m: 9 }, square), false);
  const inside = buildMetricMotorcycleMapping([detection], [assignment], homography, physical).motorcycles[0];
  assert.equal(inside.physical_containment, 'INSIDE_PHYSICAL_ROW');
  assert.equal(inside.assignment_comparison, 'MATCH');
  const outsideDetection = { ...detection, bbox: { x: .8, y: .8, width: .1, height: .1 } };
  assert.equal(buildMetricMotorcycleMapping([outsideDetection], [assignment], homography, physical).motorcycles[0].physical_containment, 'OUTSIDE_PHYSICAL_ROWS');
  const overlapping = { ...physical, rows: physical.rows.map((row, index) => index === 1 ? { ...row, physical_polygon: square } : row) };
  assert.equal(buildMetricMotorcycleMapping([detection], [assignment], homography, overlapping).motorcycles[0].physical_containment, 'MULTIPLE_PHYSICAL_ROWS');
});

void test('assignment cross-check reports mismatch without changing image assignment', () => {
  const mismatch = buildMetricMotorcycleMapping([detection], [{ ...assignment, row_id: 'row_2', matching_rows: ['row_2'] }], homography, physical).motorcycles[0];
  assert.equal(mismatch.assignment_comparison, 'MISMATCH');
  assert.equal(mismatch.image_row_assignment.row_id, 'row_2');
  assert.equal(mismatch.physical_row_id, 'row_1');
});

void test('outside-ROI detection stays in analysis mapping but has no metric map point', () => {
  const outside = { ...assignment, status: 'OUTSIDE_ROI' as const, row_id: null, matching_rows: [] };
  const result = buildMetricMotorcycleMapping([detection], [outside], homography, physical);
  assert.equal(result.motorcycles.length, 1);
  assert.equal(result.motorcycles[0].inside_parking_roi, false);
  assert.equal(result.motorcycles[0].metric_point, null);
  assert.equal(result.motorcycles[0].transform_valid, false);
  assert.equal(parkingMapMotorcycles(result).length, 0);
});

void test('inside ROI without an image row remains eligible for metric rendering', () => {
  const unassigned = { ...assignment, status: 'UNASSIGNED' as const, row_id: null, matching_rows: [] };
  const result = buildMetricMotorcycleMapping([detection], [unassigned], homography, physical).motorcycles[0];
  assert.equal(result.inside_parking_roi, true);
  assert.equal(result.transform_valid, true);
  assert.equal(parkingMapMotorcycles({ status: 'READY', motorcycles: [result] }).length, 1);
});

void test('physical map reuses the validated metric ROI from homography', () => {
  const metricRoi = [{ x_m: 0, y_m: 0 }, { x_m: 14, y_m: 0 }, { x_m: 14, y_m: 14 }, { x_m: 0, y_m: 14 }];
  const response = { ...homography, result: { ...homography.result!, roi_metric: { id: 'parking_roi', points: metricRoi, longitudinal_extent_m: 14, cross_extent_m: 14, measured_length_m: null, measured_width_m: null, length_difference_m: null, width_difference_m: null } } } as GroundPlaneHomographyResponse;
  assert.deepEqual(parkingMapRoi(response), metricRoi);
  assert.deepEqual(parkingMapRoi({ ...response, status: 'STALE', current: false }), []);
});
