import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMotorcycleFittingData, classifyGap } from './motorcycleFitting.ts';
import { buildOccupiedIntervalPrototype } from './occupiedIntervals.ts';
import type { DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { MetricCalibrationResponse } from '../types/metricCalibration.ts';
import type { OccupiedGap, OccupiedIntervalPrototypeData } from '../types/occupiedIntervals.ts';

const gap = (length: number | null, source: OccupiedGap['metric_source'] = 'ESTIMATED'): OccupiedGap => ({ row_id: 'row_1', t_start: .2, t_end: .4, normalized_length: .2, position_start_m: length === null ? null : 1, position_end_m: length === null ? null : 1 + length, gap_length_m: length, metric_source: length === null ? null : source });
const config = (required_space_m: number, measurement_source: 'ESTIMATED' | 'MEASURED' = 'ESTIMATED') => ({ schema_version: 1 as const, measurement_source, required_space_m });

void test('gap greater than requirement is FIT_CANDIDATE', () => assert.equal(classifyGap(gap(2), config(1.5)).state, 'FIT_CANDIDATE'));
void test('gap equal to requirement is FIT_CANDIDATE', () => assert.equal(classifyGap(gap(1.5), config(1.5)).state, 'FIT_CANDIDATE'));
void test('gap below requirement is TOO_SMALL', () => assert.equal(classifyGap(gap(1.49), config(1.5)).state, 'TOO_SMALL'));
void test('missing row length is UNCERTAIN', () => assert.deepEqual([classifyGap(gap(null), config(1.5)).state, classifyGap(gap(null), config(1.5)).reason], ['UNCERTAIN', 'MISSING_ROW_LENGTH']));
void test('missing fitting configuration is UNCERTAIN', () => assert.equal(classifyGap(gap(2), null).reason, 'MISSING_FITTING_CONFIGURATION'));
void test('estimated fitting provenance is preserved', () => assert.equal(classifyGap(gap(2), config(1, 'ESTIMATED')).fitting_source, 'ESTIMATED'));
void test('measured fitting provenance is preserved independently', () => { const result = classifyGap(gap(2, 'ESTIMATED'), config(1, 'MEASURED')); assert.equal(result.gap_metric_source, 'ESTIMATED'); assert.equal(result.fitting_source, 'MEASURED'); });
void test('one gap produces one classification and no capacity', () => { const intervals = { rows: [{ row_id: 'row_1', name: 'Parking Row 1', gaps: [gap(5)] }], ground_proxy_height_ratio: .2, ignored: { outside_roi: [], unassigned_without_row_overlap: [], ambiguous_without_candidate_overlap: [] }, unsupported: [] } as unknown as OccupiedIntervalPrototypeData; const result = buildMotorcycleFittingData(intervals, config(1)); assert.equal(result.rows[0].gaps.length, 1); assert.equal('capacity' in result.rows[0], false); });
void test('fitting consumes gaps split by EXTERNAL_OBSTRUCTION', () => { const polygon = [{ x: .1, y: .2 }, { x: .9, y: .2 }, { x: .9, y: .4 }, { x: .1, y: .4 }]; const calibration: ParkingCalibration = { schema_version: 2, camera_id: 'test', reference_image: { width: 100, height: 100 }, parking_roi: { polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, rows: [{ id: 'row_1', name: 'Parking Row 1', polygon }] }; const detection: Detection = { class_id: 0, class_name: 'motorcycle', confidence: .9, bbox: { x: .4, y: .1, width: .2, height: .2 } }; const assignment: DetectionRowAssignment = { detection_index: 0, ground_point: { x: .5, y: .3 }, status: 'OUTSIDE_ROI', row_id: null, matching_rows: [] }; const metric: MetricCalibrationResponse = { status: 'CALIBRATED', measurement_source: 'MEASURED', row_measurements_complete: true, ground_plane_calibration_available: false, calibration: { schema_version: 1, camera_id: 'test', unit: 'meter', measurement_source: 'MEASURED', rows: [{ id: 'row_1', length_m: 8 }], reference_segments: [], ground_control_points: [] } }; const intervals = buildOccupiedIntervalPrototype([detection], [assignment], calibration, metric); const fitting = buildMotorcycleFittingData(intervals, config(3)); assert.equal(intervals.rows[0].gaps.length, 2); assert.deepEqual(fitting.rows[0].gaps.map((item) => item.state), ['FIT_CANDIDATE', 'FIT_CANDIDATE']); });
