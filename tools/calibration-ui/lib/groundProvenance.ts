import type { GroundProvenance, MetricMeasurementSource } from '../types/groundPlaneCalibration.ts';

/** Changes an input's provenance. A MEASURED input carries no estimation basis, so it is dropped. */
export function withProvenance<T extends GroundProvenance>(item: T, provenance: MetricMeasurementSource): T {
  return provenance === 'MEASURED' ? { ...item, provenance, estimation_basis: null } : { ...item, provenance };
}

/** Why the backend would reject this input's provenance, or null when it is complete. */
export function provenanceProblem(item: GroundProvenance): string | null {
  if (item.provenance === 'MEASURED') return null;
  if (!(typeof item.uncertainty_m === 'number' && item.uncertainty_m > 0)) return 'needs a positive uncertainty in metres';
  if (!item.estimation_basis?.trim()) return 'needs an estimation basis';
  return null;
}
