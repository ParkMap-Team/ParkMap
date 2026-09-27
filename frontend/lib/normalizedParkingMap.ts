import type { RowOccupancyProjectionData } from '../types/calibration.ts';
import type { MotorcycleFittingData } from '../types/motorcycleFitting.ts';
import type { NormalizedParkingMapData } from '../types/normalizedParkingMap.ts';
import type { OccupiedIntervalPrototypeData } from '../types/occupiedIntervals.ts';
import type { MetricCalibrationResponse } from '../types/metricCalibration.ts';
import type { ParkingCalibration } from '../types/calibration.ts';
import { buildHybridLayout } from './hybridParkingMap.ts';

export function buildNormalizedParkingMapData(projection: RowOccupancyProjectionData, intervals: OccupiedIntervalPrototypeData, fitting: MotorcycleFittingData | null, metricCalibration: MetricCalibrationResponse | null = null, calibration: ParkingCalibration | null = null): NormalizedParkingMapData {
  return {
    map_mode: 'NORMALIZED',
    rows: intervals.rows,
    assigned_markers: projection.rows.flatMap((row) => row.motorcycles.map((item) => ({ detection_index: item.detection_index, row_id: item.row_id, t: item.row_position.t, status: 'ASSIGNED' as const }))),
    ambiguous_count: projection.ambiguous.length,
    unassigned_count: projection.unassigned.length,
    outside_roi_count: projection.outside_roi.length,
    fitting,
    row_lengths: Object.fromEntries(intervals.rows.map((row) => [row.row_id, metricCalibration?.calibration?.rows.find((measurement) => measurement.id === row.row_id)?.length_m ?? null])),
    row_length_source: metricCalibration?.calibration?.measurement_source ?? null,
    hybrid_layout: calibration ? buildHybridLayout(calibration) : null,
  };
}
