import type { OccupiedInterval } from '../types/occupiedIntervals.ts';

export function obstructionLabel(interval: Pick<OccupiedInterval, 'detection_index' | 'source_type'>): string {
  const suffix = interval.source_type === 'EXTERNAL_OBSTRUCTION' ? ' EXT' : interval.source_type === 'AMBIGUOUS_OBSTRUCTION' ? ' !' : interval.source_type === 'UNASSIGNED_OBSTRUCTION' ? ' ?' : '';
  return `#${interval.detection_index}${suffix}`;
}
