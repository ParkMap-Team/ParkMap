import assert from 'node:assert/strict';
import test from 'node:test';
import { boxFromPoints, moveBox } from './annotationEditor.ts';

void test('drawing backwards produces a normalized box and movement stays inside the image', () => {
  const box = boxFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });
  assert.equal(box.x, 0.2); assert.equal(box.y, 0.3);
  assert.ok(Math.abs(box.width - 0.4) < 1e-10);
  assert.ok(Math.abs(box.height - 0.5) < 1e-10);
  const moved = moveBox(box, 2, -2);
  assert.ok(Math.abs(moved.x - 0.6) < 1e-10);
  assert.equal(moved.y, 0);
  assert.deepEqual(boxFromPoints({ x: -1, y: -2 }, { x: 2, y: 3 }), { x: 0, y: 0, width: 1, height: 1 });
});
