import type { MetricPoint, MetricPolygon, MotorcycleProxy } from "../api/types.ts";

// Plain metric ground geometry shared by the 2D and 3D maps. Nothing here decides availability:
// it only draws and locates polygons the API returned.

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(points: Iterable<MetricPoint>): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { x_m, y_m } of points) {
    bounds.minX = Math.min(bounds.minX, x_m);
    bounds.minY = Math.min(bounds.minY, y_m);
    bounds.maxX = Math.max(bounds.maxX, x_m);
    bounds.maxY = Math.max(bounds.maxY, y_m);
  }
  return bounds;
}

export function boundsCenter(bounds: Bounds): MetricPoint {
  return { x_m: (bounds.minX + bounds.maxX) / 2, y_m: (bounds.minY + bounds.maxY) / 2 };
}

function pointInRing({ x_m: x, y_m: y }: MetricPoint, ring: MetricPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y_m > y !== b.y_m > y && x < ((b.x_m - a.x_m) * (y - a.y_m)) / (b.y_m - a.y_m) + a.x_m) inside = !inside;
  }
  return inside;
}

/** Inside the exterior ring and outside every hole. */
export function pointInPolygon(point: MetricPoint, [outer, ...holes]: MetricPolygon): boolean {
  return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

/** A point inside the polygon to anchor a label or focus the map: the area centroid when it lies inside. */
export function labelPoint(polygon: MetricPolygon): MetricPoint {
  const outer = polygon[0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const cross = outer[j].x_m * outer[i].y_m - outer[i].x_m * outer[j].y_m;
    area += cross;
    cx += (outer[j].x_m + outer[i].x_m) * cross;
    cy += (outer[j].y_m + outer[i].y_m) * cross;
  }
  const centroid = area === 0 ? boundsCenter(boundsOf(outer)) : { x_m: cx / (3 * area), y_m: cy / (3 * area) };
  if (pointInPolygon(centroid, polygon)) return centroid;
  // A concave ring can put its centroid outside; the midpoint of a vertex and its far neighbour is a safe fallback.
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 2) % outer.length];
    const mid = { x_m: (a.x_m + b.x_m) / 2, y_m: (a.y_m + b.y_m) / 2 };
    if (pointInPolygon(mid, polygon)) return mid;
  }
  return outer[0];
}

/**
 * A proxy's long-axis heading folded into (-π/2, π/2]. Front and rear are not resolved (ADR 0009),
 * so a heading and its opposite draw the same proxy and a re-fit never flips it on screen.
 */
export function axisHeading(headingRad: number): number {
  let heading = headingRad % Math.PI;
  if (heading <= -Math.PI / 2) heading += Math.PI;
  if (heading > Math.PI / 2) heading -= Math.PI;
  return heading;
}

/** The ground rectangle a proxy occupies, from the API's centre, long axis, length, and width. */
export function proxyFootprint(proxy: MotorcycleProxy): MetricPolygon {
  const heading = axisHeading(proxy.heading_rad);
  const along = { x: Math.cos(heading) * (proxy.length_m / 2), y: Math.sin(heading) * (proxy.length_m / 2) };
  const across = { x: -Math.sin(heading) * (proxy.width_m / 2), y: Math.cos(heading) * (proxy.width_m / 2) };
  const { x_m, y_m } = proxy.center;
  return [
    [
      { x_m: x_m - along.x - across.x, y_m: y_m - along.y - across.y },
      { x_m: x_m + along.x - across.x, y_m: y_m + along.y - across.y },
      { x_m: x_m + along.x + across.x, y_m: y_m + along.y + across.y },
      { x_m: x_m - along.x + across.x, y_m: y_m - along.y + across.y },
    ],
  ];
}

/** Points along a polygon's outer edge, at every corner and no farther apart than `spacingM`. */
export function edgePoints([outer]: MetricPolygon, spacingM: number): MetricPoint[] {
  return outer.flatMap((start, index) => {
    const end = outer[(index + 1) % outer.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m) / spacingM));
    return Array.from({ length: steps }, (_, step) => ({
      x_m: start.x_m + ((end.x_m - start.x_m) * step) / steps,
      y_m: start.y_m + ((end.y_m - start.y_m) * step) / steps,
    }));
  });
}

/** Metric ground (x, y) maps to world (x, height, -y); the world Y axis points up. */
export function toWorld({ x_m, y_m }: MetricPoint, height = 0): [number, number, number] {
  return [x_m, height, -y_m];
}

export function fromWorld(x: number, z: number): MetricPoint {
  return { x_m: x, y_m: -z };
}
