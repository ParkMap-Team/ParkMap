import type { RowOccupancyProjectionData } from '../types/calibration.ts';
import type { MotorcycleFittingData } from '../types/motorcycleFitting.ts';
import type { NormalizedParkingMapData } from '../types/normalizedParkingMap.ts';
import type { OccupiedIntervalPrototypeData } from '../types/occupiedIntervals.ts';

export function buildNormalizedParkingMapData(projection: RowOccupancyProjectionData, intervals: OccupiedIntervalPrototypeData, fitting: MotorcycleFittingData | null): NormalizedParkingMapData {
  return {
    map_mode: 'NORMALIZED',
    rows: intervals.rows,
    assigned_markers: projection.rows.flatMap((row) => row.motorcycles.map((item) => ({ detection_index: item.detection_index, row_id: item.row_id, t: item.row_position.t, status: 'ASSIGNED' as const }))),
    ambiguous_count: projection.ambiguous.length,
    unassigned_count: projection.unassigned.length,
    outside_roi_count: projection.outside_roi.length,
    fitting,
  };
}
