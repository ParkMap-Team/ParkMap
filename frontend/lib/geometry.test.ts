import assert from 'node:assert/strict';
import test from 'node:test';
import { motorcycleGroundPoint, pointInPolygon } from './geometry.ts';

void test('motorcycleGroundPoint returns normalized bottom-center', () => {
  assert.deepEqual(motorcycleGroundPoint({ x: 0.2, y: 0.3, width: 0.4, height: 0.5 }), { x: 0.4, y: 0.8 });
});

void test('pointInPolygon handles inside, outside, and incomplete polygons', () => {
  const square = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
  assert.equal(pointInPolygon({ x: 0.5, y: 0.5 }, square), true);
  assert.equal(pointInPolygon({ x: 0.95, y: 0.5 }, square), false);
  assert.equal(pointInPolygon({ x: 0.5, y: 0.5 }, square.slice(0, 2)), false);
});
