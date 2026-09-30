import { calculateOccupiedSpaceV1, type OccupiedSpaceV1 } from './occupiedSpace';
import { calculateFreeSpaceV1, type FreeSpaceV1Result } from './freeSpace';
import type { MetricMotorcycle } from '../types/metricMotorcycle';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry';
import type { ParkingAnalysisResponse } from '../types/parkingAnalysis';

// TEMPORARY FRONTEND REFERENCE PATH.
// Remove after Backend Parking Analysis V1 reaches regression parity.
export function buildLegacyParkingGeometry(motorcycles: MetricMotorcycle[], physical: PhysicalRowGeometryResponse): { occupiedSpace: OccupiedSpaceV1; freeSpace: FreeSpaceV1Result } {
  const occupiedSpace = calculateOccupiedSpaceV1(motorcycles, physical);
  return { occupiedSpace, freeSpace: calculateFreeSpaceV1(physical, occupiedSpace) };
}

export function adaptBackendParkingGeometry(analysis: ParkingAnalysisResponse): { occupiedSpace: OccupiedSpaceV1; freeSpace: FreeSpaceV1Result } {
  return {
    occupiedSpace: { rows: analysis.occupied_space.rows.map((row) => ({ ...row, blocking_motorcycle_count: row.blocking_detection_ids?.length ?? 0, assigned_block_count: 0, cross_row_block_count: 0, ambiguous_block_count: 0, unassigned_block_count: 0, raw_intersection_sum_m2: row.occupied_union_area_m2, deduplicated_overlap_m2: 0, remaining_geometric_area_m2: row.row_area_m2 - row.occupied_union_area_m2, remaining_geometric_percent: 100 - row.occupied_percent, contributions: row.contributions ?? [], components: row.components ?? [] })), included_without_row_block: [] },
    freeSpace: { rows: analysis.free_space.rows, diagnostics: { valid: analysis.free_space.rows.every((row) => row.validation_status === 'VALID'), errors: analysis.free_space.rows.filter((row) => row.validation_status !== 'VALID').map((row) => `${row.row_id}: backend validation failed`) } },
  };
}
