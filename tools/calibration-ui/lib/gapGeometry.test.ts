import assert from 'node:assert/strict';
import test from 'node:test';
import type { components } from '../types/api.gen';
import { metricGapPath, imageGapPath } from './gapGeometry.ts';

void test('candidate overlays preserve holes and disconnected parts from the backend', () => {
  const polygons = [
    [[[0, 0], [4, 0], [4, 4], [0, 4]], [[1, 1], [2, 1], [2, 2], [1, 2]]],
    [[[5, 0], [6, 0], [6, 1], [5, 1]]],
  ];
  const gap = {
    geometry_metric: { polygons: polygons.map(rings => rings.map(ring => ring.map(([x_m, y_m]) => ({ x_m, y_m })))) },
    geometry_image: { polygons: polygons.map(rings => rings.map(ring => ring.map(([x, y]) => ({ x, y })))) },
    polygon_metric: [{ x_m: 99, y_m: 99 }], polygon_image: [{ x: 99, y: 99 }],
  } as components['schemas']['GapCandidate'];
  for (const output of [metricGapPath(gap), imageGapPath(gap)]) {
    assert.equal(output.match(/M/g)?.length, 3);
    assert.match(output, /M1,1 L2,1 L2,2 L1,2 Z/);
    assert.doesNotMatch(output, /99/);
  }
  // A failed full projection must never fill the exterior fallback across holes.
  assert.equal(imageGapPath({ ...gap, geometry_image: null }), '');
});
