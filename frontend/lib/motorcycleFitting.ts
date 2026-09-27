import type { MotorcycleFittingConfiguration, MotorcycleFittingData, GapFittingResult } from '../types/motorcycleFitting.ts';
import type { OccupiedIntervalPrototypeData, OccupiedGap } from '../types/occupiedIntervals.ts';

export const FITTING_EPSILON = 1e-9;

export function classifyGap(gap: OccupiedGap, configuration: MotorcycleFittingConfiguration | null): GapFittingResult {
  if (gap.gap_length_m === null || gap.metric_source === null) return { gap, state: 'UNCERTAIN', reason: 'MISSING_ROW_LENGTH', gap_metric_source: null, fitting_source: configuration?.measurement_source ?? null, required_space_m: configuration?.required_space_m ?? null };
  if (!configuration) return { gap, state: 'UNCERTAIN', reason: 'MISSING_FITTING_CONFIGURATION', gap_metric_source: gap.metric_source, fitting_source: null, required_space_m: null };
  return { gap, state: gap.gap_length_m + FITTING_EPSILON >= configuration.required_space_m ? 'FIT_CANDIDATE' : 'TOO_SMALL', reason: null, gap_metric_source: gap.metric_source, fitting_source: configuration.measurement_source, required_space_m: configuration.required_space_m };
}

export function buildMotorcycleFittingData(intervals: OccupiedIntervalPrototypeData, configuration: MotorcycleFittingConfiguration | null): MotorcycleFittingData {
  return { configuration, rows: intervals.rows.map((row) => {
    const gaps = row.gaps.map((gap) => classifyGap(gap, configuration));
    return { row_id: row.row_id, name: row.name, gaps, summary: {
      FIT_CANDIDATE: gaps.filter((item) => item.state === 'FIT_CANDIDATE').length,
      TOO_SMALL: gaps.filter((item) => item.state === 'TOO_SMALL').length,
      UNCERTAIN: gaps.filter((item) => item.state === 'UNCERTAIN').length,
    } };
  }) };
}
