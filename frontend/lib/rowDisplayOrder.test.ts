import assert from 'node:assert/strict';
import test from 'node:test';
import { orderRowsForDisplay, persistRowDisplayOrder, readRowDisplayOrder, ROW_DISPLAY_ORDER_STORAGE_KEY } from './rowDisplayOrder.ts';

const canonicalRows = [1, 2, 3, 4, 5].map((number) => ({
  row_id: `row_${number}`,
  marker: number === 1 ? { detection_index: 28, row_id: 'row_1', t: .123 } : null,
  occupied: [{ row_id: `row_${number}`, t_start: .1, t_end: .2 }],
  obstructions: [{ row_id: `row_${number}`, t_start: .3, t_end: .4 }],
  fitting: { row_id: `row_${number}`, state: number % 2 ? 'FIT_CANDIDATE' : 'TOO_SMALL' },
}));

void test('ASCENDING renders Row 1,2,3,4,5', () => assert.deepEqual(orderRowsForDisplay(canonicalRows, 'ASCENDING').map((row) => row.row_id), ['row_1', 'row_2', 'row_3', 'row_4', 'row_5']));
void test('DESCENDING renders Row 5,4,3,2,1', () => assert.deepEqual(orderRowsForDisplay(canonicalRows, 'DESCENDING').map((row) => row.row_id), ['row_5', 'row_4', 'row_3', 'row_2', 'row_1']));
void test('switching order does not modify row_id', () => assert.equal(orderRowsForDisplay(canonicalRows, 'DESCENDING')[4].row_id, 'row_1'));
void test('switching order does not modify t', () => assert.equal(orderRowsForDisplay(canonicalRows, 'DESCENDING')[4].marker?.t, .123));
void test('#28 remains associated with row_1 after reverse display', () => { const row = orderRowsForDisplay(canonicalRows, 'DESCENDING').find((item) => item.marker?.detection_index === 28); assert.equal(row?.row_id, 'row_1'); assert.equal(row?.marker?.row_id, 'row_1'); });
void test('occupied intervals remain associated with their original row', () => assert.equal(orderRowsForDisplay(canonicalRows, 'DESCENDING')[4].occupied[0].row_id, 'row_1'));
void test('obstruction intervals remain associated with their original row', () => assert.equal(orderRowsForDisplay(canonicalRows, 'DESCENDING')[0].obstructions[0].row_id, 'row_5'));
void test('fitting results remain associated with their original row', () => assert.equal(orderRowsForDisplay(canonicalRows, 'DESCENDING')[0].fitting.row_id, 'row_5'));
void test('display reversal does not transform t to 1-t', () => assert.notEqual(orderRowsForDisplay(canonicalRows, 'DESCENDING')[4].marker?.t, 1 - .123));
void test('original canonical row array is not mutated', () => { const before = JSON.stringify(canonicalRows); const displayed = orderRowsForDisplay(canonicalRows, 'DESCENDING'); assert.equal(JSON.stringify(canonicalRows), before); assert.notStrictEqual(displayed, canonicalRows); });
void test('fullscreen can use the same selected order value', () => { const selected = 'DESCENDING' as const; assert.deepEqual(orderRowsForDisplay(canonicalRows, selected), orderRowsForDisplay(canonicalRows, selected)); });
void test('preference persists across remount when storage is available', () => { const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; persistRowDisplayOrder('DESCENDING', storage); assert.equal(values.get(ROW_DISPLAY_ORDER_STORAGE_KEY), 'DESCENDING'); assert.equal(readRowDisplayOrder(storage), 'DESCENDING'); });
void test('invalid or missing preference defaults to ASCENDING', () => { assert.equal(readRowDisplayOrder(null), 'ASCENDING'); assert.equal(readRowDisplayOrder({ getItem: () => 'SIDEWAYS' }), 'ASCENDING'); });
void test('new analysis data does not alter the independent display preference', () => { const selected = 'DESCENDING' as const; const replacement = canonicalRows.map((row) => ({ ...row })); assert.equal(orderRowsForDisplay(replacement, selected)[0].row_id, 'row_5'); });
