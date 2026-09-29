import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFreeSpaceV1 } from './freeSpace.ts';
import type { OccupiedSpaceV1 } from './occupiedSpace';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry';

const square = [{ x_m: 0, y_m: 0 }, { x_m: 10, y_m: 0 }, { x_m: 10, y_m: 10 }, { x_m: 0, y_m: 10 }];
const physical = { status: 'CURRENT', rows: [{ row_id: 'row_1', status: 'PHYSICAL_READY', physical_polygon: square }] } as unknown as PhysicalRowGeometryResponse;
const occupied = (geometry: OccupiedSpaceV1['rows'][number]['occupied_geometry'], area: number): OccupiedSpaceV1 => ({ rows: [{ row_id: 'row_1', row_area_m2: 100, blocking_motorcycle_count: 1, assigned_block_count: 1, cross_row_block_count: 0, ambiguous_block_count: 0, unassigned_block_count: 0, raw_intersection_sum_m2: area, occupied_union_area_m2: area, deduplicated_overlap_m2: 0, remaining_geometric_area_m2: 100 - area, occupied_percent: area, remaining_geometric_percent: 100 - area, occupied_geometry: geometry, contributions: [] }], included_without_row_block: [] });

void test('derives free geometry without manual row endpoints', () => {
  const result = calculateFreeSpaceV1(physical, occupied({ polygons: [] }, 0));
  assert.equal(result.rows[0].free_area_m2, 100);
  assert.equal(result.rows[0].free_component_count, 1);
  assert.equal(result.rows[0].validation_status, 'VALID');
});

void test('preserves disconnected free components and holes', () => {
  const blocker = { polygons: [[[{ x_m: 4, y_m: 0 }, { x_m: 6, y_m: 0 }, { x_m: 6, y_m: 10 }, { x_m: 4, y_m: 10 }]]] };
  const result = calculateFreeSpaceV1(physical, occupied(blocker, 20));
  assert.equal(result.rows[0].free_component_count, 2);
  assert.equal(result.rows[0].free_area_m2, 80);
  assert.equal(result.diagnostics.valid, true);
});

void test('full occupied row yields empty free geometry', () => {
  const result = calculateFreeSpaceV1(physical, occupied({ polygons: [[square]] }, 100));
  assert.equal(result.rows[0].free_area_m2, 0);
  assert.equal(result.rows[0].free_component_count, 0);
});
