import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoFrameTimes } from './videoFrames.ts';

void test('samples a video every five seconds without exceeding its duration', () => {
  assert.deepEqual(buildVideoFrameTimes(16), [0, 5, 10, 15]);
  assert.deepEqual(buildVideoFrameTimes(5), [0]);
});

void test('rejects invalid durations and intervals safely', () => {
  assert.deepEqual(buildVideoFrameTimes(0), []);
  assert.deepEqual(buildVideoFrameTimes(Number.NaN), []);
  assert.throws(() => buildVideoFrameTimes(30, 0), /positive/);
  assert.throws(() => buildVideoFrameTimes(3_601), /60 minutes/);
});
