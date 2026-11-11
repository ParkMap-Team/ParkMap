import assert from 'node:assert/strict';
import test from 'node:test';
import type { components } from '../types/api.gen';
import { unknownGapDisplay } from './unknownGapDisplay.ts';

type Gap = components['schemas']['GapCandidate'];
const gap = (id: string, row: string, left: number, right: number, state = 'UNKNOWN') => ({
  id, row_id: row, state, width_check: 'INSUFFICIENT',
  polygon_metric: [[left, 0], [right, 0], [right, 2], [left, 2]].map(([x_m, y_m]) => ({ x_m, y_m })),
}) as Gap;

void test('grey display joins touching regions only within a row without bridging other states or changing source evidence', () => {
  const candidates = [gap('a', 'row_1', 0, 1), gap('b', 'row_1', 1, 2),
    gap('green', 'row_1', 2, 3, 'WIDTH_SUFFICIENT'), gap('c', 'row_1', 3, 4),
    gap('d', 'row_2', 0, 1)];
  const original = structuredClone(candidates);
  const display = unknownGapDisplay(candidates, false);
  assert.equal(display.length, 2);
  assert.equal(display[0].polygons.length, 2);
  assert.equal(display[1].polygons.length, 1);
  const first = display[0].polygons[0][0];
  assert.equal(Math.min(...first.map(point => point[0])), 0);
  assert.equal(Math.max(...first.map(point => point[0])), 2);
  assert.deepEqual(candidates, original);
});

void test('width preview stays separate and empty results produce no display', () => {
  const preview = { ...gap('preview', 'row_1', 0, 1), width_check: 'SUFFICIENT' } as Gap;
  assert.equal(unknownGapDisplay([preview], true).length, 0);
  assert.equal(unknownGapDisplay([preview], false).length, 1);
  assert.deepEqual(unknownGapDisplay([], false), []);
});

void test('grey display preserves holes rather than filling unassessed ground', () => {
  const item = gap('hole', 'row_1', 0, 4);
  item.geometry_metric = { polygons: [[item.polygon_metric,
    [[1, .5], [2, .5], [2, 1.5], [1, 1.5]].map(([x_m, y_m]) => ({ x_m, y_m }))]] };
  assert.equal(unknownGapDisplay([item], false)[0].polygons[0].length, 2);
});
