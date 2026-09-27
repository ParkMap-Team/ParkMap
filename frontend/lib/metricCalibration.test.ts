import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedRowPositionToMeters } from './metricConversion.ts';

void test('converts normalized t when a measured row length exists', () => assert.deepEqual(normalizedRowPositionToMeters(.4, 10), { ok: true, position_m: 4 }));
void test('refuses conversion when row length is missing', () => assert.deepEqual(normalizedRowPositionToMeters(.4), { ok: false, error: 'MISSING_ROW_LENGTH' }));
void test('maps t=0 to zero meters', () => assert.deepEqual(normalizedRowPositionToMeters(0, 12), { ok: true, position_m: 0 }));
void test('maps t=1 to the measured row length', () => assert.deepEqual(normalizedRowPositionToMeters(1, 12), { ok: true, position_m: 12 }));
void test('rejects invalid input and never substitutes a fake length', () => {
  assert.deepEqual(normalizedRowPositionToMeters(1.1, 12), { ok: false, error: 'INVALID_NORMALIZED_POSITION' });
  assert.deepEqual(normalizedRowPositionToMeters(.5, 0), { ok: false, error: 'INVALID_ROW_LENGTH' });
});
