import type { MetricPoint } from "../api/types.ts";

export const ROUTE_REVEAL_MS = 2300;
/** How long the chevrons flow along the route once it is drawn; rendering then stops to spare the battery. */
export const ROUTE_FLOW_S = 7;
const ROUTE_FLOW_FADE_S = 1;

/** The chevrons' opacity, so they fade out before the flow stops instead of freezing mid-stride. */
export function routeFlowOpacity(elapsedS: number): number {
  const t = Math.min(1, Math.max(0, (ROUTE_FLOW_S - elapsedS) / ROUTE_FLOW_FADE_S));
  return t * t * (3 - 2 * t);
}

/** Use the last part of the drawn route so the arrow turns smoothly through a corner. */
export function routeArrow(points: readonly MetricPoint[]): MetricPoint[] | undefined {
  const tip = points.at(-1);
  if (!tip) return;
  let remaining = 0.7;
  for (let index = points.length - 2; index >= 0; index--) {
    const end = points[index + 1];
    const start = points[index];
    const length = Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m);
    if (length === 0) continue;
    if (length < remaining && index > 0) {
      remaining -= length;
      continue;
    }
    const fraction = Math.min(1, remaining / length);
    const dx = tip.x_m - end.x_m + (end.x_m - start.x_m) * fraction;
    const dy = tip.y_m - end.y_m + (end.y_m - start.y_m) * fraction;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.000001) return;
    const x = dx / distance;
    const y = dy / distance;
    return [
      { x_m: tip.x_m - 0.65 * x + 0.36 * y, y_m: tip.y_m - 0.65 * y - 0.36 * x },
      tip,
      { x_m: tip.x_m - 0.65 * x - 0.36 * y, y_m: tip.y_m - 0.65 * y + 0.36 * x },
    ];
  }
}

export function revealRoute(route: readonly MetricPoint[], progress: number): readonly MetricPoint[] {
  if (progress >= 1 || route.length < 2) return route;
  const lengths = route.slice(1).map((point, index) => Math.hypot(point.x_m - route[index].x_m, point.y_m - route[index].y_m));
  let remaining = lengths.reduce((total, length) => total + length, 0) * Math.max(0, progress);
  for (const [index, length] of lengths.entries()) {
    if (length > 0 && remaining <= length) {
      const start = route[index];
      const end = route[index + 1];
      const fraction = remaining / length;
      return [...route.slice(0, index + 1), {
        x_m: start.x_m + (end.x_m - start.x_m) * fraction,
        y_m: start.y_m + (end.y_m - start.y_m) * fraction,
      }];
    }
    remaining -= length;
  }
  return route;
}
