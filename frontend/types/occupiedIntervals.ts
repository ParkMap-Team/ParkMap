import type { CalibrationRow, RowCenterlineResult } from './calibration';
import type { MetricMeasurementSource } from './metricCalibration';

export type OccupiedIntervalSource = 'ASSIGNED' | 'UNASSIGNED_OBSTRUCTION' | 'AMBIGUOUS_OBSTRUCTION' | 'EXTERNAL_OBSTRUCTION';

export interface OccupiedInterval {
  row_id: CalibrationRow['id'];
  detection_index: number;
  source_type: OccupiedIntervalSource;
  t_start: number;
  t_end: number;
  position_start_m: number | null;
  position_end_m: number | null;
  metric_source: MetricMeasurementSource | null;
}

export interface MergedOccupiedInterval extends Omit<OccupiedInterval, 'detection_index' | 'source_type'> {
  detection_indices: number[];
  source_types: OccupiedIntervalSource[];
}

export interface OccupiedGap {
  row_id: CalibrationRow['id'];
  t_start: number;
  t_end: number;
  normalized_length: number;
  position_start_m: number | null;
  position_end_m: number | null;
  gap_length_m: number | null;
  metric_source: MetricMeasurementSource | null;
}

export interface OccupiedIntervalRow {
  row_id: CalibrationRow['id'];
  name: CalibrationRow['name'];
  centerline: RowCenterlineResult;
  intervals: OccupiedInterval[];
  merged_intervals: MergedOccupiedInterval[];
  gaps: OccupiedGap[];
  contributing_detection_count: number;
  obstruction_count: number;
  external_obstruction_count: number;
  before_external_obstructions: {
    intervals: OccupiedInterval[];
    merged_intervals: MergedOccupiedInterval[];
    gaps: OccupiedGap[];
    contributing_detection_count: number;
    merged_interval_count: number;
    gap_count: number;
    largest_gap_m: number | null;
  };
}

export interface OccupiedIntervalPrototypeData {
  ground_proxy_height_ratio: 0.2;
  rows: OccupiedIntervalRow[];
  ignored: {
    outside_roi: number[];
    unassigned_without_row_overlap: number[];
    ambiguous_without_candidate_overlap: number[];
  };
  unsupported: Array<{ detection_index: number; row_id: CalibrationRow['id'] | null; error: string }>;
}
