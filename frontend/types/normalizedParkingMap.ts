import type { RowAssignmentStatus } from './calibration';
import type { MotorcycleFittingData } from './motorcycleFitting';
import type { OccupiedIntervalPrototypeData } from './occupiedIntervals';
import type { MetricMeasurementSource } from './metricCalibration';

export type ParkingMapMode = 'NORMALIZED' | 'METRIC_GROUND';
export interface NormalizedMotorcycleMarker { detection_index: number; row_id: string; t: number; status: Extract<RowAssignmentStatus, 'ASSIGNED'>; }
export interface NormalizedParkingMapData {
  map_mode: 'NORMALIZED';
  rows: OccupiedIntervalPrototypeData['rows'];
  assigned_markers: NormalizedMotorcycleMarker[];
  ambiguous_count: number;
  unassigned_count: number;
  outside_roi_count: number;
  fitting: MotorcycleFittingData | null;
  row_lengths: Record<string, number | null>;
  row_length_source: MetricMeasurementSource | null;
}
