import type { MetricMeasurementSource } from './metricCalibration';
import type { OccupiedGap } from './occupiedIntervals';

export type MotorcycleFittingState = 'FIT_CANDIDATE' | 'TOO_SMALL' | 'UNCERTAIN';
export type MotorcycleFittingReason = 'MISSING_ROW_LENGTH' | 'MISSING_FITTING_CONFIGURATION' | null;

export interface MotorcycleFittingConfiguration {
  schema_version: 1;
  measurement_source: MetricMeasurementSource;
  required_space_m: number;
}

export interface MotorcycleFittingResponse {
  configured: boolean;
  configuration: MotorcycleFittingConfiguration | null;
}

export interface GapFittingResult {
  gap: OccupiedGap;
  state: MotorcycleFittingState;
  reason: MotorcycleFittingReason;
  gap_metric_source: MetricMeasurementSource | null;
  fitting_source: MetricMeasurementSource | null;
  required_space_m: number | null;
}

export interface MotorcycleFittingData {
  rows: Array<{ row_id: string; name: string; gaps: GapFittingResult[]; summary: Record<MotorcycleFittingState, number> }>;
  configuration: MotorcycleFittingConfiguration | null;
}
