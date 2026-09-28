import type { CalibrationPoint, CalibrationRow, DetectionRowAssignment } from './calibration';
import type { DetectionBBox } from './detection';
import type { GroundPlaneMetricPoint } from './groundPlaneCalibration';
import type { FootprintOverlap } from '../lib/motorcycleFootprint';

export type PhysicalContainment =
  | 'INSIDE_PHYSICAL_ROW'
  | 'OUTSIDE_PHYSICAL_ROWS'
  | 'MULTIPLE_PHYSICAL_ROWS';

export interface MetricMotorcycle {
  detection_id: string;
  detection_index: number;
  confidence: number;
  bbox: DetectionBBox;
  image_ground_point: CalibrationPoint;
  inside_parking_roi: boolean;
  metric_point: GroundPlaneMetricPoint | null;
  transform_valid: boolean;
  image_row_assignment: DetectionRowAssignment;
  physical_containment: PhysicalContainment;
  physical_row_id: CalibrationRow['id'] | null;
  matching_physical_rows: CalibrationRow['id'][];
  assignment_comparison: 'MATCH' | 'MISMATCH';
  footprint_polygon: GroundPlaneMetricPoint[] | null;
  footprint_area_m2: number | null;
  footprint_orientation_row_id: CalibrationRow['id'] | null;
  footprint_candidate_row_id: CalibrationRow['id'] | null;
  row_overlaps: Array<FootprintOverlap & { row_id: CalibrationRow['id'] }>;
}

export interface MetricMotorcycleMapping {
  status: 'READY' | 'CALIBRATION_REQUIRED';
  motorcycles: MetricMotorcycle[];
}
