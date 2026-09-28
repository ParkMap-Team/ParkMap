import type { CalibrationPoint, CalibrationRow, DetectionRowAssignment } from './calibration';
import type { DetectionBBox } from './detection';
import type { GroundPlaneMetricPoint } from './groundPlaneCalibration';

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
  metric_point: GroundPlaneMetricPoint | null;
  transform_valid: boolean;
  image_row_assignment: DetectionRowAssignment;
  physical_containment: PhysicalContainment;
  physical_row_id: CalibrationRow['id'] | null;
  matching_physical_rows: CalibrationRow['id'][];
  assignment_comparison: 'MATCH' | 'MISMATCH';
}

export interface MetricMotorcycleMapping {
  status: 'READY' | 'CALIBRATION_REQUIRED';
  motorcycles: MetricMotorcycle[];
}
