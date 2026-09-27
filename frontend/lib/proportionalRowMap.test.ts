import assert from 'node:assert/strict';
import test from 'node:test';
import { positionWithinProportionalRow, proportionalRowWidth } from './proportionalRowMap.ts';
import { orderRowsForDisplay } from './rowDisplayOrder.ts';

void test('15 m relative to 18 m produces proportional width 0.833333', () => assert.ok(Math.abs((proportionalRowWidth(15, [15, 15, 15, 18, 18]) ?? 0) - 15 / 18) < 1e-12));
void test('longest row has width ratio 1', () => assert.equal(proportionalRowWidth(18, [15, 18]), 1));
void test('t remains relative to the width of its own row', () => { assert.equal(positionWithinProportionalRow(.5, 15 / 18), 15 / 36); assert.equal(positionWithinProportionalRow(.5, 1), .5); });
void test('missing or invalid row length is explicit', () => { assert.equal(proportionalRowWidth(null, [15, 18]), null); assert.equal(proportionalRowWidth(0, [15, 18]), null); });
void test('display reversal preserves row length and geometry', () => { const rows = [{ row_id: 'row_1', length: 15, t: .4 }, { row_id: 'row_2', length: 18, t: .7 }]; const reversed = orderRowsForDisplay(rows, 'DESCENDING'); assert.deepEqual(reversed, [rows[1], rows[0]]); });
void test('proportional positioning does not modify assignment, t, or occupancy data', () => { const analysis = { assignment: 'OUTSIDE_ROI', t: .42, interval: { t_start: .2, t_end: .5, source: 'EXTERNAL_OBSTRUCTION' } }; const before = JSON.stringify(analysis); positionWithinProportionalRow(analysis.t, 15 / 18); assert.equal(JSON.stringify(analysis), before); });
