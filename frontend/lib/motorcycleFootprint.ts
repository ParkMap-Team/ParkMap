import type { GroundPlaneMetricPoint } from '../types/groundPlaneCalibration';

export const MOTORCYCLE_FOOTPRINT_CONFIG = {
  motorcycle_width_m: 0.8,
  motorcycle_length_m: 2.0,
  provenance: 'PROTOTYPE_ESTIMATE' as const,
};

export type UnitVector = { x: number; y: number };
export type FootprintOverlap = { intersection_area_m2: number; footprint_area_m2: number; overlap_ratio: number; overlap_percent: number };

const point = (x: number, y: number): GroundPlaneMetricPoint => ({ x_m: x, y_m: y });
const signedArea = (p: GroundPlaneMetricPoint[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x_m * b.y_m - b.x_m * a.y_m; }, 0) / 2;

export function buildMotorcycleFootprint(anchor: GroundPlaneMetricPoint, direction: UnitVector, width = MOTORCYCLE_FOOTPRINT_CONFIG.motorcycle_width_m, length = MOTORCYCLE_FOOTPRINT_CONFIG.motorcycle_length_m, inward?: UnitVector) {
  const n = { x: -direction.y, y: direction.x };
  const halfWidth = width / 2;
  const axis = inward ?? n;
  const nearLeft = point(anchor.x_m - direction.x * halfWidth, anchor.y_m - direction.y * halfWidth);
  const nearRight = point(anchor.x_m + direction.x * halfWidth, anchor.y_m + direction.y * halfWidth);
  const farRight = point(nearRight.x_m + axis.x * length, nearRight.y_m + axis.y * length);
  const farLeft = point(nearLeft.x_m + axis.x * length, nearLeft.y_m + axis.y * length);
  const rearLeft = nearLeft;
  const rearRight = nearRight;
  const frontRight = farRight;
  const frontLeft = farLeft;
  return [rearLeft, rearRight, frontRight, frontLeft];
}

export function polygonArea(polygon: GroundPlaneMetricPoint[]) { return Math.abs(signedArea(polygon)); }

function intersection(a: GroundPlaneMetricPoint, b: GroundPlaneMetricPoint, c: GroundPlaneMetricPoint, d: GroundPlaneMetricPoint) {
  const den = (a.x_m - b.x_m) * (c.y_m - d.y_m) - (a.y_m - b.y_m) * (c.x_m - d.x_m);
  if (Math.abs(den) < 1e-9) return b;
  const t = ((a.x_m - c.x_m) * (c.y_m - d.y_m) - (a.y_m - c.y_m) * (c.x_m - d.x_m)) / den;
  return point(a.x_m + t * (b.x_m - a.x_m), a.y_m + t * (b.y_m - a.y_m));
}

export function polygonIntersectionArea(subject: GroundPlaneMetricPoint[], clip: GroundPlaneMetricPoint[]) {
  let output = subject.slice();
  const orientation = signedArea(clip) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p: GroundPlaneMetricPoint) => orientation * ((b.x_m - a.x_m) * (p.y_m - a.y_m) - (b.y_m - a.y_m) * (p.x_m - a.x_m)) >= -1e-9;
    const input = output; output = [];
    for (let j = 0; j < input.length; j++) { const current = input[j], previous = input[(j + input.length - 1) % input.length]; const ci = inside(current), pi = inside(previous); if (ci !== pi) output.push(intersection(previous, current, a, b)); if (ci) output.push(current); }
  }
  return polygonArea(output);
}

export function footprintOverlap(footprint: GroundPlaneMetricPoint[], row: GroundPlaneMetricPoint[]): FootprintOverlap {
  const area = polygonArea(footprint); const intersectionArea = polygonIntersectionArea(footprint, row); const ratio = area ? Math.min(1, Math.max(0, intersectionArea / area)) : 0;
  return { intersection_area_m2: intersectionArea, footprint_area_m2: area, overlap_ratio: ratio, overlap_percent: ratio * 100 };
}

export function rowDirection(row: GroundPlaneMetricPoint[]): UnitVector {
  let best = { length: -1, x: 1, y: 0 };
  for (let i = 0; i < row.length; i++) { const a = row[i], b = row[(i + 1) % row.length]; const x = b.x_m - a.x_m, y = b.y_m - a.y_m, length = Math.hypot(x, y); if (length > best.length) best = { length, x: x / length, y: y / length }; }
  return { x: best.x, y: best.y };
}
