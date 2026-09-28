import { imageNormalizedToGroundMeters } from './groundPlaneHomography';
import type { DetectionBBox } from '../types/detection';
import type { GroundPlaneMetricPoint } from '../types/groundPlaneCalibration';

export type ExperimentalSizeStatus = 'VALID' | 'SUSPICIOUS' | 'INVALID';
export interface ExperimentalMotorcycleSize { bbox_width_px: number; bbox_height_px: number; local_scale_m_per_px: { x: number; y: number }; estimated_width_m: number | null; bottom_band_width_m: number | null; status: ExperimentalSizeStatus; delta_px: number; }
const distance = (a: GroundPlaneMetricPoint, b: GroundPlaneMetricPoint) => Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
export function estimateMotorcycleSize(bbox: DetectionBBox, imageWidth: number, imageHeight: number, matrix: number[][], deltaPx = 16): ExperimentalMotorcycleSize {
  const width = (bbox.width * imageWidth), height = (bbox.height * imageHeight), gx = bbox.x + bbox.width / 2, gy = bbox.y + bbox.height;
  const p = imageNormalizedToGroundMeters(gx, gy, matrix), px = imageNormalizedToGroundMeters(gx + deltaPx / imageWidth, gy, matrix), py = imageNormalizedToGroundMeters(gx, gy + deltaPx / imageHeight, matrix);
  if (!p || !px || !py || !Number.isFinite(width) || width <= 0) return { bbox_width_px: width, bbox_height_px: height, local_scale_m_per_px: { x: NaN, y: NaN }, estimated_width_m: null, bottom_band_width_m: null, status: 'INVALID', delta_px: deltaPx };
  const sx = distance(p, px) / deltaPx, sy = distance(p, py) / deltaPx, estimate = width * sx;
  const band = width * sx;
  return { bbox_width_px: width, bbox_height_px: height, local_scale_m_per_px: { x: sx, y: sy }, estimated_width_m: Number.isFinite(estimate) ? estimate : null, bottom_band_width_m: Number.isFinite(band) ? band : null, status: Number.isFinite(estimate) && sx > 0 && sx < 10 ? 'VALID' : 'SUSPICIOUS', delta_px: deltaPx };
}
