import assert from 'node:assert/strict';
import test from 'node:test';
import { assignDetectionToParkingRow, assignDetectionsToParkingRows } from './rowAssignment.ts';
import type { ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';

const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

const calibration: ParkingCalibration = {
  schema_version: 2,
  camera_id: 'SPU_CAM_01',
  reference_image: { width: 400, height: 300 },
  parking_roi: { polygon: rectangle(0.1, 0.1, 0.9, 0.9) },
  rows: [
    { id: 'row_1', name: 'Parking Row 1', polygon: rectangle(0.1, 0.1, 0.9, 0.2) },
    { id: 'row_2', name: 'Parking Row 2', polygon: rectangle(0.1, 0.25, 0.9, 0.35) },
    { id: 'row_3', name: 'Parking Row 3', polygon: rectangle(0.1, 0.4, 0.9, 0.5) },
    { id: 'row_4', name: 'Parking Row 4', polygon: rectangle(0.1, 0.55, 0.9, 0.65) },
    { id: 'row_5', name: 'Parking Row 5', polygon: rectangle(0.1, 0.7, 0.9, 0.8) },
  ],
};

const detectionAtGroundPoint = (x: number, y: number): Detection => ({
  class_id: 0,
  class_name: 'motorcycle',
  confidence: 0.9,
  bbox: { x: x - 0.05, y: y - 0.1, width: 0.1, height: 0.1 },
});

void test('assigns outside, exactly one row, and between-row detections', () => {
  assert.equal(assignDetectionToParkingRow(detectionAtGroundPoint(0.95, 0.5), calibration).status, 'OUTSIDE_ROI');
  const assigned = assignDetectionToParkingRow(detectionAtGroundPoint(0.5, 0.45), calibration);
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.row_id, 'row_3');
  assert.deepEqual(assigned.matching_rows, ['row_3']);
  assert.equal(assignDetectionToParkingRow(detectionAtGroundPoint(0.5, 0.375), calibration).status, 'UNASSIGNED');
});

void test('reports all overlapping rows as ambiguous without choosing one', () => {
  const overlapping = structuredClone(calibration);
  overlapping.rows[1].polygon = rectangle(0.1, 0.4, 0.9, 0.5);
  const assignment = assignDetectionToParkingRow(detectionAtGroundPoint(0.5, 0.45), overlapping);
  assert.equal(assignment.status, 'AMBIGUOUS');
  assert.equal(assignment.row_id, null);
  assert.deepEqual(assignment.matching_rows, ['row_2', 'row_3']);
});

void test('supports exactly five rows and keeps normalized output', () => {
  const assignments = assignDetectionsToParkingRows([detectionAtGroundPoint(0.5, 0.75)], calibration);
  assert.equal(calibration.rows.length, 5);
  assert.equal(assignments[0].row_id, 'row_5');
  assert.ok(assignments[0].ground_point.x >= 0 && assignments[0].ground_point.x <= 1);
  assert.ok(assignments[0].ground_point.y >= 0 && assignments[0].ground_point.y <= 1);
});

void test('does not mutate calibration or detection input', () => {
  const calibrationInput = structuredClone(calibration);
  const detectionInput = detectionAtGroundPoint(0.5, 0.45);
  const calibrationBefore = structuredClone(calibrationInput);
  const detectionBefore = structuredClone(detectionInput);
  assignDetectionToParkingRow(detectionInput, calibrationInput);
  assert.deepEqual(calibrationInput, calibrationBefore);
  assert.deepEqual(detectionInput, detectionBefore);
});
