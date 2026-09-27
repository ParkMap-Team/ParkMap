import type { CalibrationPoint, DetectionRowAssignment } from './calibration';
import type { OutsideRoiProxyDiagnosticsData } from './occupancyDiagnostics';

export type RoiSpatialMapMode = 'IMAGE_NORMALIZED' | 'METRIC_GROUND';
export interface RoiViewport { min_x: number; max_x: number; min_y: number; max_y: number; width: number; height: number; }
export interface RoiSpatialShape { id: string; name: string; polygon: CalibrationPoint[]; }
export interface RoiSpatialMapData {
  map_mode: 'IMAGE_NORMALIZED';
  parking_roi: CalibrationPoint[];
  rows: RoiSpatialShape[];
  viewport: RoiViewport;
  assignments: DetectionRowAssignment[];
  outside_roi_diagnostics: OutsideRoiProxyDiagnosticsData;
}
