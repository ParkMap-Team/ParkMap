'use client';

import { withProvenance } from '@/lib/groundProvenance';
import type { GroundProvenance, MetricMeasurementSource } from '@/types/groundPlaneCalibration';

export function ProvenanceFields<T extends GroundProvenance>({ label, value, onChange }: { label: string; value: T; onChange: (next: T) => void }) {
  return <div className="grid gap-2 sm:grid-cols-3">
    <label className="text-xs text-slate-500">Provenance<select aria-label={`${label} provenance`} value={value.provenance} onChange={(event) => onChange(withProvenance(value, event.target.value as MetricMeasurementSource))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900"><option value="MEASURED">Measured on site</option><option value="ESTIMATED">Estimated</option></select></label>
    {value.provenance === 'ESTIMATED' && <>
      <label className="text-xs text-slate-500">Uncertainty (m)<input aria-label={`${label} uncertainty in metres`} type="number" min="0" step="any" value={value.uncertainty_m ?? ''} onChange={(event) => onChange({ ...value, uncertainty_m: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900" /></label>
      <label className="text-xs text-slate-500">Estimation basis<input aria-label={`${label} estimation basis`} maxLength={500} value={value.estimation_basis ?? ''} onChange={(event) => onChange({ ...value, estimation_basis: event.target.value === '' ? null : event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900" /></label>
    </>}
  </div>;
}
