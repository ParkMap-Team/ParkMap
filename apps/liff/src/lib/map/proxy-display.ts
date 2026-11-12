import type { LiveRegion, MotorcycleProxy } from '../api/types.ts';
import { labelPoint, pointInPolygon, proxyFootprint } from './geometry.ts';

/** Display-only fit to this detection's occupied band. No nearest-neighbour guessing. */
export function fitProxyDisplay(proxy: MotorcycleProxy, regions: LiveRegion[]): MotorcycleProxy {
  const candidates = regions.filter(region => region.kind === 'OCCUPIED' && region.detection_id === proxy.detection_id
    && region.polygon.length === 1 && region.polygon[0].length >= 3);
  const area = (region: LiveRegion) => Math.abs(region.polygon[0].reduce((sum, p, i, ring) => {
    const next = ring[(i + 1) % ring.length];
    return sum + p.x_m * next.y_m - next.x_m * p.y_m;
  }, 0));
  // A clipped band can split into several pieces. Draw one icon in its largest piece.
  candidates.sort((a, b) => area(b) - area(a));
  const band = candidates[0];
  if (!band) return proxy;
  const ring = band.polygon[0];
  const edges = ring.map((p, i) => ({ x: ring[(i + 1) % ring.length].x_m - p.x_m, y: ring[(i + 1) % ring.length].y_m - p.y_m }));
  // Clipping can add vertices, a closing point, or a notch along the ROI boundary.
  const nonzero = edges.filter(edge => Math.hypot(edge.x, edge.y) > 1e-8);
  const turns = nonzero.map((edge, i) => {
    const next = nonzero[(i + 1) % nonzero.length];
    return edge.x * next.y - edge.y * next.x;
  }).filter(turn => Math.abs(turn) > 1e-8);
  if (!turns.length) return proxy;
  const longest = edges.reduce((a, b) => Math.hypot(a.x, a.y) > Math.hypot(b.x, b.y) ? a : b);
  // A crosswise motorcycle remains at its observed position and heading.
  const alignment = Math.abs((longest.x * Math.cos(proxy.heading_rad) + longest.y * Math.sin(proxy.heading_rad)) / Math.hypot(longest.x, longest.y));
  if (alignment < .7) return proxy;
  const center = labelPoint(band.polygon);
  let low = 0, high = 1;
  for (let step = 0; step < 24; step++) {
    const scale = (low + high) / 2;
    const fitted = { ...proxy, center, length_m: proxy.length_m * scale, width_m: proxy.width_m * scale };
    const corners = proxyFootprint(fitted)[0];
    const inside = corners.every((p, i) => {
      const next = corners[(i + 1) % corners.length];
      return Array.from({ length: 21 }, (_, step) => ({ x_m: p.x_m + (next.x_m - p.x_m) * step / 20,
        y_m: p.y_m + (next.y_m - p.y_m) * step / 20 })).every(point => pointInPolygon(point, band.polygon));
    });
    if (inside) low = scale;
    else high = scale;
  }
  return { ...proxy, center, length_m: proxy.length_m * low * .9, width_m: proxy.width_m * low * .9 };
}
