import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceSizeGeometry } from './referenceSizeGeometry.ts';
import type { MetricMotorcycleMapping } from '../types/metricMotorcycle.ts';

void test('reference-size map uses Python polygons joined by detection identity, without mutating the standard map', () => {
  const original = { status: 'READY', motorcycles: [{ detection_index: 2, footprint_polygon: [{ x_m: 9, y_m: 9 }] }] } as MetricMotorcycleMapping;
  const polygon = [{ x_m: 1, y_m: 1 }, { x_m: 2, y_m: 1 }, { x_m: 2, y_m: 3 }, { x_m: 1, y_m: 3 }];
  const mapped = referenceSizeGeometry(original, [{ detection_index: 2, canonical_footprint: { polygons: [[polygon]] }, footprint_area_m2: 2,
    metric_ground_point: { x_m: 1.5, y_m: 1 }, inside_parking_roi: true }]);
  assert.deepEqual(mapped.motorcycles[0].footprint_polygon, polygon);
  assert.equal(mapped.motorcycles[0].footprint_area_m2, 2);
  assert.equal(mapped.motorcycles[0].inside_parking_roi, true);
  assert.deepEqual(original.motorcycles[0].footprint_polygon, [{ x_m: 9, y_m: 9 }]);
});
