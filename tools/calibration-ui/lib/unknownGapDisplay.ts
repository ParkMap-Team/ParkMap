import polygonClipping from 'polygon-clipping';
import type { components } from '../types/api.gen';
import { isWidthPreview } from './segmentationGapPresentation.ts';

type Gap = components['schemas']['GapCandidate'];

// Presentation union only: keep every original candidate for selection/evidence.
export function unknownGapDisplay(candidates: Gap[], previewWidthOnly: boolean) {
  const rows = new Map<string, polygonClipping.MultiPolygon[]>();
  for (const gap of candidates) {
    if (gap.state !== 'UNKNOWN' || isWidthPreview(gap, previewWidthOnly)) continue;
    const polygons = (gap.geometry_metric?.polygons ?? [[gap.polygon_metric]])
      .map(rings => rings.map(ring => ring.map(point => [point.x_m, point.y_m] as [number, number])));
    const row = rows.get(gap.row_id) ?? [];
    row.push(polygons);
    rows.set(gap.row_id, row);
  }
  return [...rows].map(([rowId, geometries]) => ({ rowId,
    polygons: polygonClipping.union(geometries[0], ...geometries.slice(1)),
  }));
}
