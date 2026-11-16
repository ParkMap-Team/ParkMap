import type { MetricPoint } from "../api/types.ts";

const CORNER_RADIUS_M = 0.55;
const CORNER_STEPS = 8;
const PROFILE = [
  { offset: -0.54, rise: 0, across: 0 },
  { offset: -0.41, rise: 0, across: 0.12 },
  { offset: -0.36, rise: 0.14, across: 0.18 },
  { offset: 0.36, rise: 0.14, across: 0.82 },
  { offset: 0.41, rise: 0, across: 0.88 },
  { offset: 0.54, rise: 0, across: 1 },
];

function mix(a: MetricPoint, b: MetricPoint, t: number): MetricPoint {
  return { x_m: a.x_m + (b.x_m - a.x_m) * t, y_m: a.y_m + (b.y_m - a.y_m) * t };
}

function roundedCentreline(points: readonly MetricPoint[]): MetricPoint[] {
  const distinct = points.filter((point, index) => !index || point.x_m !== points[index - 1].x_m || point.y_m !== points[index - 1].y_m);
  if (distinct.length < 3) return distinct;
  const rounded = [distinct[0]];
  for (let index = 1; index < distinct.length - 1; index++) {
    const previous = distinct[index - 1];
    const corner = distinct[index];
    const next = distinct[index + 1];
    const incoming = Math.hypot(previous.x_m - corner.x_m, previous.y_m - corner.y_m);
    const outgoing = Math.hypot(next.x_m - corner.x_m, next.y_m - corner.y_m);
    const radius = Math.min(CORNER_RADIUS_M, incoming * 0.4, outgoing * 0.4);
    const start = mix(corner, previous, radius / incoming);
    const end = mix(corner, next, radius / outgoing);
    for (let step = 0; step <= CORNER_STEPS; step++) {
      const t = step / CORNER_STEPS;
      rounded.push(mix(mix(start, corner, t), mix(corner, end, t), t));
    }
  }
  rounded.push(distinct[distinct.length - 1]);
  return rounded;
}

/** A raised ribbon in world metres, with distance along the route in uv.x. */
export function parkingRibbon(route: readonly MetricPoint[], height: number) {
  const points = roundedCentreline(route);
  if (points.length < 2) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let length = 0;
  for (const [index, point] of points.entries()) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    length += Math.hypot(point.x_m - previous.x_m, point.y_m - previous.y_m);
    const dx = next.x_m - previous.x_m;
    const dy = next.y_m - previous.y_m;
    const span = Math.hypot(dx, dy) || 1;
    for (const { offset, rise, across } of PROFILE) {
      positions.push(point.x_m - (dy / span) * offset, height + rise, -point.y_m - (dx / span) * offset);
      uvs.push(length, across);
    }
    if (index === 0) continue;
    for (let side = 0; side < PROFILE.length - 1; side++) {
      const first = (index - 1) * PROFILE.length + side;
      const nextRow = first + PROFILE.length;
      indices.push(first, first + 1, nextRow, first + 1, nextRow + 1, nextRow);
    }
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices), length };
}
