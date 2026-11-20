import assert from 'node:assert/strict';
import test from 'node:test';
import { motorcycleDisplayWidth } from './segmentationMotorcycleDisplay.ts';

void test('uses backend estimate directly in physical metres without changing the standard width', () => {
  const proxy = { width_m: .66, estimated_width_m: .9 };
  assert.equal(motorcycleDisplayWidth(proxy), .9);
  assert.equal(proxy.width_m, .66);
});

void test('missing estimates retain the standard reference width', () => {
  assert.equal(motorcycleDisplayWidth({ width_m: .66, estimated_width_m: null }), .66);
  assert.equal(motorcycleDisplayWidth({ width_m: .66 }), .66);
});
