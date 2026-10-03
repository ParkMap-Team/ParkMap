import { geometryArea, polygonDifference, type MetricMultiPolygon } from './polygonUnion.ts';
import { polygonArea } from './motorcycleFootprint.ts';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry';
import type { OccupiedSpaceV1 } from './occupiedSpace';

export interface FreeSpaceRowResult {
  row_id: string;
  row_area_m2: number;
  occupied_union_area_m2: number;
  free_geometry: MetricMultiPolygon;
  free_area_m2: number;
  free_component_count: number;
  hole_count: number;
  occupied_percent: number;
  free_percent: number;
  validation_status: 'VALID' | 'INVALID';
}

export interface FreeSpaceV1Result {
  rows: FreeSpaceRowResult[];
  diagnostics: { valid: boolean; errors: string[] };
}

const EPSILON = 1e-7;

export function calculateFreeSpaceV1(physical: PhysicalRowGeometryResponse, occupied: OccupiedSpaceV1): FreeSpaceV1Result {
  const errors: string[] = [];
  const rows = physical.rows.filter((row) => row.status === 'PHYSICAL_READY' && row.physical_polygon);
  const results = rows.map((row) => {
    const polygon = row.physical_polygon!;
    const rowArea = polygonArea(polygon);
    const occupiedRow = occupied.rows.find((candidate) => candidate.row_id === row.row_id);
    const occupiedGeometry = occupiedRow?.occupied_geometry ?? { polygons: [] };
    const occupiedArea = occupiedRow?.occupied_union_area_m2 ?? geometryArea(occupiedGeometry);
    const freeGeometry = polygonDifference(polygon, occupiedGeometry);
    const freeArea = geometryArea(freeGeometry);
    const balanceError = Math.abs(rowArea - occupiedArea - freeArea);
    const valid = [rowArea, occupiedArea, freeArea].every(Number.isFinite)
      && rowArea >= -EPSILON && occupiedArea >= -EPSILON && freeArea >= -EPSILON
      && occupiedArea <= rowArea + EPSILON && freeArea <= rowArea + EPSILON
      && balanceError <= EPSILON;
    if (!valid) errors.push(`${row.row_id}: free-space area validation failed (balance error ${balanceError})`);
    return {
      row_id: row.row_id,
      row_area_m2: rowArea,
      occupied_union_area_m2: occupiedArea,
      free_geometry: freeGeometry,
      free_area_m2: freeArea,
      free_component_count: freeGeometry.polygons.length,
      hole_count: freeGeometry.polygons.reduce((count, polygonPart) => count + Math.max(0, polygonPart.length - 1), 0),
      occupied_percent: rowArea > EPSILON ? occupiedArea / rowArea * 100 : 0,
      free_percent: rowArea > EPSILON ? freeArea / rowArea * 100 : 0,
      validation_status: (valid ? 'VALID' : 'INVALID') as 'VALID' | 'INVALID',
    };
  });
  return { rows: results, diagnostics: { valid: errors.length === 0, errors } };
}
