import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationRequest, boxFromPoints, moveBox } from './annotationEditor.ts';

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

void test('validation failures show a short message without echoing all annotation inputs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: [{ msg: 'Invalid box', input: { annotations: ['private-label-data'] } }] }, { status: 422 }));
  await assert.rejects(annotationRequest('demo', 'save', 'PUT', 'id', {}), (error: Error) => error.message === 'Invalid box');
});
