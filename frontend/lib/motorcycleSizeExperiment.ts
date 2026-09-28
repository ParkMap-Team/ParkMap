import { imageNormalizedToGroundMeters } from './groundPlaneHomography';
import type { DetectionBBox } from '../types/detection';
import type { GroundPlaneMetricPoint } from '../types/groundPlaneCalibration';

export type ExperimentalSizeStatus = 'VALID' | 'SUSPICIOUS' | 'INVALID';
export interface ExperimentalMotorcycleSize { bbox_width_px: number; bbox_height_px: number; image_ground_y: number; local_horizontal_m_per_px: number | null; estimated_width_m: number | null; baseline_width_m: number; difference_m: number | null; difference_percent: number | null; bottom_band_width_m: null; bottom_band_reason: 'DETECTION_BBOX_HAS_NO_BOTTOM_BAND_CONTOUR'; status: ExperimentalSizeStatus; delta_px: number; }
const distance = (a: GroundPlaneMetricPoint, b: GroundPlaneMetricPoint) => Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
export function estimateMotorcycleSize(bbox: DetectionBBox, imageWidth: number, imageHeight: number, matrix: number[][], deltaPx = 16): ExperimentalMotorcycleSize {
  const width = bbox.width * imageWidth, height = bbox.height * imageHeight, gx = bbox.x + bbox.width / 2, gy = bbox.y + bbox.height, invalid = (status: ExperimentalSizeStatus = 'INVALID'): ExperimentalMotorcycleSize => ({ bbox_width_px: width, bbox_height_px: height, image_ground_y: gy * imageHeight, local_horizontal_m_per_px: null, estimated_width_m: null, baseline_width_m: .8, difference_m: null, difference_percent: null, bottom_band_width_m: null, bottom_band_reason: 'DETECTION_BBOX_HAS_NO_BOTTOM_BAND_CONTOUR', status, delta_px: deltaPx });
  const p = imageNormalizedToGroundMeters(gx, gy, matrix), px1 = imageNormalizedToGroundMeters(gx + deltaPx / imageWidth, gy, matrix), px0 = imageNormalizedToGroundMeters(gx - deltaPx / imageWidth, gy, matrix);
  if (!p || !px1 || !px0 || !Number.isFinite(width) || width <= 0) return invalid();
  const scale = distance(px0, px1) / (2 * deltaPx), estimate = width * scale;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(estimate)) return invalid();
  const difference = estimate - .8;
  return { bbox_width_px: width, bbox_height_px: height, image_ground_y: gy * imageHeight, local_horizontal_m_per_px: scale, estimated_width_m: estimate, baseline_width_m: .8, difference_m: difference, difference_percent: difference / .8 * 100, bottom_band_width_m: null, bottom_band_reason: 'DETECTION_BBOX_HAS_NO_BOTTOM_BAND_CONTOUR', status: estimate > 3 ? 'SUSPICIOUS' : 'VALID', delta_px: deltaPx };
}
