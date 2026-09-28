import polygonClipping from 'polygon-clipping';
import type { GroundPlaneMetricPoint } from '../types/groundPlaneCalibration';

export type MetricPolygon = GroundPlaneMetricPoint[];
export interface MetricMultiPolygon { polygons: MetricPolygon[][]; }
const toCoordinates = (p: MetricPolygon) => [p.map((x) => [x.x_m, x.y_m] as [number, number])];
const fromCoordinates = (p: number[][][]) => p.map((ring) => ring.map(([x, y]) => ({ x_m: x, y_m: y })));
export function polygonUnion(polygons: MetricPolygon[]): MetricMultiPolygon { if (!polygons.length) return { polygons: [] }; let result = polygonClipping.union(toCoordinates(polygons[0]), toCoordinates(polygons[0])); for (const polygon of polygons.slice(1)) result = polygonClipping.union(result, toCoordinates(polygon)); return { polygons: result.map(fromCoordinates) }; }
export function geometryArea(geometry: MetricMultiPolygon): number { return geometry.polygons.reduce((sum, polygon) => sum + Math.abs(polygon[0].reduce((a, p, i) => { const n = polygon[0][(i + 1) % polygon[0].length]; return a + p.x_m * n.y_m - n.x_m * p.y_m; }, 0) / 2) - polygon.slice(1).reduce((holes, ring) => holes + Math.abs(ring.reduce((a, p, i) => { const n = ring[(i + 1) % ring.length]; return a + p.x_m * n.y_m - n.x_m * p.y_m; }, 0) / 2), 0), 0); }
