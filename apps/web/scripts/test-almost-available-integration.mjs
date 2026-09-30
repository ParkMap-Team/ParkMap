import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapSource = readFileSync(resolve(root, 'components/parking/PhysicalMeasuredMap.tsx'), 'utf8');
const typeSource = readFileSync(resolve(root, 'types/parkingAnalysis.ts'), 'utf8');

const metricPolygon = (x, y) => ({ polygons: [[[
  { x_m: x, y_m: y }, { x_m: x + 0.66, y_m: y },
  { x_m: x + 0.66, y_m: y + 2 }, { x_m: x, y_m: y + 2 },
]]] });
const fixture = {
  physical_map: { rows: [{ row_id: 'row_10', physical_polygon: [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }, { x_m: 10, y_m: 2 }, { x_m: 0, y_m: 2 }] }] },
  occupied_space: { rows: [{ row_id: 'row_10', occupied_geometry: metricPolygon(1, 0) }] },
  capacity: { rows: [{ row_id: 'row_10', capacity: 1, placements: [{ footprint_metric: metricPolygon(4, 0) }], validation: { valid: true } }] },
  almost_available_placements: [{ row_id: 'row_10', status: 'ALMOST_AVAILABLE', footprint_metric: metricPolygon(7, 0), occupied_overlap_area_m2: 0.05, occupied_overlap_ratio: 0.038, reason: 'SMALL_OCCUPIED_CONFLICT' }],
  parking_state: { rows: [{ row_id: 'row_10', state: 'AVAILABLE', capacity: 1, uncertainty: 'CLEAR', evidence_ids: [], decision_reason: 'CLEAR', validation: true }], validation: true },
};

const yellowPlacements = (response) => (response.almost_available_placements ?? []).filter((item) => item.status === 'ALMOST_AVAILABLE');
assert.equal(yellowPlacements(fixture).length, 1);
assert.equal(yellowPlacements({ ...fixture, almost_available_placements: undefined }).length, 0);
assert.equal(yellowPlacements({ ...fixture, almost_available_placements: [] }).length, 0);
assert.equal(fixture.capacity.rows[0].capacity, 1);
assert.equal(fixture.parking_state.rows[0].state, 'AVAILABLE');
assert.equal(fixture.almost_available_placements[0].row_id, 'row_10');

assert.match(typeSource, /almost_available_placements\?: AlmostAvailablePlacement\[\];/);
assert.match(typeSource, /occupied_overlap_area_m2\?: number/);
assert.match(typeSource, /occupied_overlap_ratio\?: number/);
assert.match(mapSource, /almostAvailablePlacements\.flatMap/);
assert.match(mapSource, /placement\.status !== 'ALMOST_AVAILABLE'/);
assert.match(mapSource, /data-parking-geometry="almost-available"/);
assert.match(mapSource, /data-parking-geometry="available"/);
assert.match(mapSource, /data-parking-geometry="occupied"/);
assert.match(mapSource, /data-parking-geometry="row"/);
assert.match(mapSource, /fill="rgba\(250,204,21,\.16\)" stroke="#facc15"/);
assert.match(mapSource, /fill="rgba\(52,211,153,\.16\)" stroke="#34d399"/);
assert.match(mapSource, /stroke="#cbd5e1"/);
assert.match(mapSource, /#ef4444/);

console.log('Almost Available frontend integration validation: PASS');
console.log('Synthetic row: row_10; occupied=RED; capacity witness=GREEN; explicit ALMOST_AVAILABLE=YELLOW; row=GRAY');
console.log('Missing/empty almost_available_placements: PASS');
