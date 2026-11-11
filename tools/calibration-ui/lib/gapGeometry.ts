import type { components } from '../types/api.gen';

type Gap = components['schemas']['GapCandidate'];

export const metricGapPath = (gap: Gap) => (gap.geometry_metric?.polygons ?? [[gap.polygon_metric]])
  .flatMap(polygon => polygon.map(ring => ring.length ? `M${ring.map(p => `${p.x_m},${p.y_m}`).join(' L')} Z` : '')).join(' ');

export const gapImageGeometry = (gap: Gap) => gap.geometry_metric
  ? gap.geometry_image : gap.polygon_image ? { polygons: [[gap.polygon_image]] } : null;

export const imageGapPath = (gap: Gap) => gapImageGeometry(gap)?.polygons
  .flatMap(polygon => polygon.map(ring => ring.length ? `M${ring.map(p => `${p.x},${p.y}`).join(' L')} Z` : '')).join(' ') ?? '';
