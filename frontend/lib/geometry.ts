import type { DetectionBBox } from '@/types/detection';
import type { CalibrationPoint } from '@/types/calibration';

export function motorcycleGroundPoint(bbox: DetectionBBox): CalibrationPoint {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height };
}

export function pointInPolygon(point: CalibrationPoint, polygon: CalibrationPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
