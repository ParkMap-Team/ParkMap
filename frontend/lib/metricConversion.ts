import type { MetricConversionResult } from '../types/metricCalibration.ts';

export function normalizedRowPositionToMeters(t: number, rowLengthM?: number | null): MetricConversionResult {
  if (!Number.isFinite(t) || t < 0 || t > 1) return { ok: false, error: 'INVALID_NORMALIZED_POSITION' };
  if (rowLengthM === undefined || rowLengthM === null) return { ok: false, error: 'MISSING_ROW_LENGTH' };
  if (!Number.isFinite(rowLengthM) || rowLengthM <= 0) return { ok: false, error: 'INVALID_ROW_LENGTH' };
  return { ok: true, position_m: t * rowLengthM };
}
