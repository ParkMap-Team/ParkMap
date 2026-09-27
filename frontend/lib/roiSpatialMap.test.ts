import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutsideRoiProxyDiagnostics } from './occupancyDiagnostics.ts';
import { buildRoiSpatialMapData, calculateRoiViewport, toRoiLocal } from './roiSpatialMap.ts';
import { orderRowsForDisplay } from './rowDisplayOrder.ts';
import type { DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';

const roi = [{ x: .1, y: .2 }, { x: .9, y: .25 }, { x: .85, y: .9 }, { x: .15, y: .85 }];
const rowNumbers = [1, 2, 3, 4, 5] as const;
const rows: ParkingCalibration['rows'] = rowNumbers.map((n) => ({ id: `row_${n}` as const, name: `Parking Row ${n}` as const, polygon: [{ x: .15, y: .2 + n * .1 }, { x: .85, y: .21 + n * .1 }, { x: .82, y: .26 + n * .1 }, { x: .17, y: .25 + n * .1 }] }));
const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: roi }, rows };
const detections: Detection[] = [
  { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .3, y: .25, width: .2, height: .3 } },
  { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .3, y: .2, width: .2, height: .5 } },
  { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .3, y: .3, width: .2, height: .5 } },
  { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .3, y: .2, width: .2, height: .5 } },
];
const assignments: DetectionRowAssignment[] = [
  { detection_index: 0, ground_point: { x: .4, y: .55 }, status: 'ASSIGNED', row_id: 'row_2', matching_rows: ['row_2'] },
  { detection_index: 1, ground_point: { x: .4, y: .7 }, status: 'UNASSIGNED', row_id: null, matching_rows: [] },
  { detection_index: 2, ground_point: { x: .4, y: .8 }, status: 'AMBIGUOUS', row_id: null, matching_rows: ['row_4', 'row_5'] },
  { detection_index: 3, ground_point: { x: .4, y: .7 }, status: 'OUTSIDE_ROI', row_id: null, matching_rows: [] },
];

void test('ROI Spatial Map uses parking_roi polygon from calibration', () => assert.deepEqual(buildRoiSpatialMapData(detections, assignments, calibration).parking_roi, roi));
void test('Rows 1–5 use their real calibration polygons', () => assert.deepEqual(buildRoiSpatialMapData(detections, assignments, calibration).rows.map((row) => row.polygon), rows.map((row) => row.polygon)));
void test('slanted polygons are not replaced with schematic rectangles', () => assert.equal(buildRoiSpatialMapData(detections, assignments, calibration).rows[0].polygon[1].y, rows[0].polygon[1].y));
void test('ROI bounding box and display padding are calculated correctly', () => { const viewport = calculateRoiViewport(roi, 0); assert.deepEqual(viewport, { min_x: .1, max_x: .9, min_y: .2, max_y: .9, width: .8, height: .7 }); });
void test('ROI-local transform maps viewport bounds to zero and one', () => { const viewport = calculateRoiViewport(roi, 0); assert.deepEqual(toRoiLocal({ x: .1, y: .2 }, viewport), { x: 0, y: 0 }); assert.deepEqual(toRoiLocal({ x: .9, y: .9 }, viewport), { x: 1, y: 1 }); });
void test('original normalized coordinates are not mutated', () => { const before = JSON.stringify(calibration); buildRoiSpatialMapData(detections, assignments, calibration); assert.equal(JSON.stringify(calibration), before); });
void test('ASSIGNED ground point remains at its real normalized position', () => assert.deepEqual(buildRoiSpatialMapData(detections, assignments, calibration).assignments[0].ground_point, { x: .4, y: .55 }));
void test('UNASSIGNED remains UNASSIGNED', () => assert.equal(buildRoiSpatialMapData(detections, assignments, calibration).assignments[1].status, 'UNASSIGNED'));
void test('AMBIGUOUS remains AMBIGUOUS', () => assert.equal(buildRoiSpatialMapData(detections, assignments, calibration).assignments[2].status, 'AMBIGUOUS'));
void test('OUTSIDE_ROI remains OUTSIDE_ROI', () => assert.equal(buildRoiSpatialMapData(detections, assignments, calibration).assignments[3].status, 'OUTSIDE_ROI'));
void test('OUTSIDE_ROI 20% proxy intersections are available diagnostically', () => { const data = buildOutsideRoiProxyDiagnostics(detections, assignments, calibration); assert.equal(data.height_ratio, .2); assert.equal(data.total, 1); assert.equal(data.detections[0].proxy_bbox !== null, true); });
void test('OUTSIDE_ROI diagnostic never converts assignment', () => assert.equal(buildOutsideRoiProxyDiagnostics(detections, assignments, calibration).detections[0].primary_assignment.status, 'OUTSIDE_ROI'));
void test('Row Map display reversal remains functional', () => assert.deepEqual(orderRowsForDisplay(rows, 'DESCENDING').map((row) => row.id), ['row_5', 'row_4', 'row_3', 'row_2', 'row_1']));
void test('Row display order does not affect ROI Spatial Map geometry', () => { const before = buildRoiSpatialMapData(detections, assignments, calibration).rows; orderRowsForDisplay(rows, 'DESCENDING'); assert.deepEqual(buildRoiSpatialMapData(detections, assignments, calibration).rows, before); });
void test('spatial map mode is IMAGE_NORMALIZED, never metric ground', () => assert.equal(buildRoiSpatialMapData(detections, assignments, calibration).map_mode, 'IMAGE_NORMALIZED'));
void test('no homography or metric coordinates are fabricated', () => { const data = buildRoiSpatialMapData(detections, assignments, calibration); assert.equal('homography' in data, false); assert.equal('metric_coordinates' in data, false); });
void test('diagnostic summary counts are derived rather than hard-coded', () => { const data = buildOutsideRoiProxyDiagnostics(detections, assignments, calibration); assert.equal(data.proxy_intersects_parking_roi + data.proxy_does_not_intersect_parking_roi, data.total); });
