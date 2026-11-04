import type { components } from '../types/api.gen';

type State = components['schemas']['GapCandidate']['state'];

// Presentation of Python-owned decisions; no width/fitting decisions in the UI.
export const gapPresentation: Record<State, { label: string; color: string; fill: string }> = {
  FIT: { label: 'ผ่านเกณฑ์ footprint ทดลอง', color: '#16a34a', fill: '#86efac' },
  WIDTH_SUFFICIENT: { label: 'กว้างพอ', color: '#16a34a', fill: '#86efac' },
  INSUFFICIENT_WIDTH: { label: 'แคบเกินไป', color: '#dc2626', fill: '#fecaca' },
  UNKNOWN: { label: 'ยังยืนยันไม่ได้', color: '#64748b', fill: '#94a3b8' },
};
