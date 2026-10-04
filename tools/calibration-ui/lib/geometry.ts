import type { DetectionBBox } from '@/types/detection';
import type { CalibrationPoint } from '@/types/calibration';

const GEOMETRY_EPSILON = 1e-9;

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getMotorcycleGroundPoint(bbox: DetectionBBox): CalibrationPoint {
  return {
    x: clampNormalized(bbox.x + bbox.width / 2),
    y: clampNormalized(bbox.y + bbox.height),
  };
}

export const motorcycleGroundPoint = getMotorcycleGroundPoint;

function pointOnSegment(point: CalibrationPoint, start: CalibrationPoint, end: CalibrationPoint): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false;
  return point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON
    && point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON
    && point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON
    && point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON;
}

export function pointInPolygon(point: CalibrationPoint, polygon: CalibrationPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
