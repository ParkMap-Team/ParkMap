import assert from 'node:assert/strict';
import test from 'node:test';
import { addGroundControlPoint, deleteGroundControlPoint, editGroundControlPoint, groundPlaneReadiness, validGroundControlPoint, validReferenceDistance } from './groundPlaneCalibrationState.ts';
import type { GroundControlPoint, GroundPlaneCalibration } from '../types/groundPlaneCalibration.ts';

const empty: GroundPlaneCalibration = { schema_version: 1, camera_id: 'test', reference_image: { width: 4032, height: 3024 }, coordinate_system: { unit: 'meter', description: 'Local parking ground-plane coordinates' }, control_points: [], reference_distances: [], measured_rows: {} };
const point = (id: string, ix: number, iy: number, gx: number, gy: number, provenance: 'ESTIMATED' | 'MEASURED' = 'MEASURED'): GroundControlPoint => ({ id, image_x: ix, image_y: iy, ground_x_m: gx, ground_y_m: gy, provenance });
const ready = [point('P1', .1, .1, 0, 0), point('P2', .9, .1, 5, 0), point('P3', .9, .9, 5, 5), point('P4', .1, .9, 0, 5)];
void test('empty config is valid and not ready', () => assert.equal(groundPlaneReadiness(empty.control_points), 'NOT_READY'));
void test('adds a control point immutably', () => { const result = addGroundControlPoint(empty, ready[0]); assert.equal(result.control_points.length, 1); assert.equal(empty.control_points.length, 0); });
void test('edits a control point', () => assert.equal(editGroundControlPoint({ ...empty, control_points: [ready[0]] }, { ...ready[0], ground_x_m: 2 }).control_points[0].ground_x_m, 2));
void test('deletes point and connected reference distances', () => { const config = { ...empty, control_points: ready.slice(0, 2), reference_distances: [{ id: 'D1', point_a: 'P1', point_b: 'P2', distance_m: 5, provenance: 'MEASURED' as const }] }; const result = deleteGroundControlPoint(config, 'P1'); assert.equal(result.control_points.length, 1); assert.equal(result.reference_distances.length, 0); });
void test('validates normalized image coordinates and finite metric coordinates', () => { assert.equal(validGroundControlPoint(ready[0]), true); assert.equal(validGroundControlPoint(point('bad', 1.1, .2, 0, 0)), false); assert.equal(validGroundControlPoint(point('bad', .2, .2, Number.NaN, 0)), false); });
void test('requires four measured non-collinear points', () => { assert.equal(groundPlaneReadiness(ready.slice(0, 3)), 'NOT_READY'); assert.equal(groundPlaneReadiness(ready), 'READY_FOR_HOMOGRAPHY'); });
void test('rejects collinear points for readiness', () => assert.equal(groundPlaneReadiness([point('P1', .1, .1, 0, 0), point('P2', .2, .2, 1, 1), point('P3', .3, .3, 2, 2), point('P4', .4, .4, 3, 3)]), 'NOT_READY'));
void test('supports more than four points', () => assert.equal(groundPlaneReadiness([...ready, point('P5', .5, .5, 2.5, 2.5)]), 'READY_FOR_HOMOGRAPHY'));
void test('validates reference distances', () => { assert.equal(validReferenceDistance({ id: 'D1', point_a: 'P1', point_b: 'P2', distance_m: 5, provenance: 'MEASURED' }, ready), true); assert.equal(validReferenceDistance({ id: 'D1', point_a: 'P1', point_b: 'P1', distance_m: 5, provenance: 'MEASURED' }, ready), false); });
void test('ESTIMATED points are not promoted to measured readiness', () => assert.equal(groundPlaneReadiness(ready.map((item) => ({ ...item, provenance: 'ESTIMATED' }))), 'NOT_READY'));
