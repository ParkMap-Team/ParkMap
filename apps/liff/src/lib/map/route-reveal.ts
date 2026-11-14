import type { MetricPoint } from "../api/types.ts";

export const ROUTE_REVEAL_MS = 2300;

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
