import assert from 'node:assert/strict';
import test from 'node:test';
import type { components } from '../types/api.gen';
import { segDetectionInspection } from './segDetectionInspection.ts';

type Gaps = components['schemas']['SegmentationGapResult'];
void test('inspection links an original Seg index to its own layer rather than a primary detection', () => {
  const gaps = { excluded_detection_ids: [], occupied_layers: [
    { detection_id: 'primary_1', detection_index: 0, source: 'PRIMARY', assigned_row_id: 'wrong' },
    { detection_id: 'detection_1', detection_index: 0, source: 'SEGMENTATION', assigned_row_id: 'row_4',
      row_assignment_distance_m: .12, row_assignment_source: 'BOTTOM_EDGE_APPROXIMATE',
      roi_geometry: { polygons: [] }, row_depth_geometry: { polygons: [[[{ x_m: 1, y_m: 2 }]]] } },
  ] } as unknown as Gaps;
  const info = segDetectionInspection(0, gaps);
  assert.equal(info.status, 'ASSIGNED');
  assert.equal(info.layer?.assigned_row_id, 'row_4');
  assert.equal(info.redBandVisible, true);
  assert.equal(info.layer?.row_assignment_distance_m, .12);
});

void test('excluded, unresolved and missing results have distinct explanations and never invent a row', () => {
  const gaps = { excluded_detection_ids: ['detection_2'], occupied_layers: [
    { detection_id: 'detection_3', detection_index: 2, source: 'SEGMENTATION', assigned_row_id: null,
      roi_geometry: { polygons: [] }, row_depth_geometry: { polygons: [] } },
  ] } as unknown as Gaps;
  assert.equal(segDetectionInspection(1, gaps).status, 'EXCLUDED');
  assert.equal(segDetectionInspection(2, gaps).status, 'UNRESOLVED');
  assert.equal(segDetectionInspection(2, gaps).redBandVisible, false);
  assert.equal(segDetectionInspection(0, gaps).status, 'NO_RECORD');
  assert.equal(segDetectionInspection(0, null).status, 'NO_ANALYSIS');
});

void test('filtered occupancy layers retain original Seg IDs, not their position in the shortened array', () => {
  const gaps = { excluded_detection_ids: ['detection_1'], occupied_layers: [
    { detection_id: 'detection_8', detection_index: 7, source: 'SEGMENTATION', assigned_row_id: 'row_2',
      roi_geometry: { polygons: [] }, row_depth_geometry: { polygons: [] } },
  ] } as unknown as Gaps;
  assert.equal(segDetectionInspection(0, gaps).status, 'EXCLUDED');
  assert.equal(segDetectionInspection(7, gaps).layer?.assigned_row_id, 'row_2');
  assert.equal(segDetectionInspection(7, gaps).redBandVisible, false);
});

void test('excluded detections expose the backend nearest-edge reason and distance without a fabricated owner', () => {
  const gaps = { occupied_layers: [], excluded_detection_ids: ['detection_33'], detection_row_assignments: [
    { detection_id: 'detection_33', assigned_row_id: null, distance_m: .23, reason: 'TOO_FAR_FROM_EDGE', ground_point: { x_m: 1, y_m: 2 } },
  ] } as unknown as Gaps;
  const info = segDetectionInspection(32, gaps);
  assert.equal(info.status, 'EXCLUDED');
  assert.equal(info.assignment?.reason, 'TOO_FAR_FROM_EDGE');
  assert.equal(info.assignment?.distance_m, .23);
  assert.equal(info.assignment?.assigned_row_id, null);
});
