import type { CalibrationPoint, CalibrationRow, DetectionRowAssignment } from './calibration';
import type { DetectionBBox } from './detection';
import type { GroundPlaneMetricPoint } from './groundPlaneCalibration';
import type { FootprintOverlap } from '../lib/motorcycleFootprint';
import type { ExperimentalMotorcycleSize } from '../lib/motorcycleSizeExperiment';

export type PhysicalContainment =
  | 'INSIDE_PHYSICAL_ROW'
  | 'OUTSIDE_PHYSICAL_ROWS'
  | 'MULTIPLE_PHYSICAL_ROWS';
export type FootprintDiagnostic = 'POINT_INSIDE_AND_FOOTPRINT_OVERLAPS' | 'POINT_OUTSIDE_BUT_FOOTPRINT_OVERLAPS' | 'POINT_OUTSIDE_AND_NO_FOOTPRINT_OVERLAP' | 'MULTIPLE_ROW_FOOTPRINT_OVERLAP';
export type RowAssignmentV2State = 'POINT_ASSIGNED' | 'FOOTPRINT_ASSIGNED' | 'AMBIGUOUS' | 'UNASSIGNED';
export interface RowAssignmentV2 { point_row_id: CalibrationRow['id'] | null; assigned_row_id: CalibrationRow['id'] | null; state: RowAssignmentV2State; best_row_id: CalibrationRow['id'] | null; best_overlap: number; second_row_id: CalibrationRow['id'] | null; second_overlap: number; overlap_margin: number; point_row_overlap: number; reason: string; }

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
  footprint_diagnostic: FootprintDiagnostic;
  best_diagnostic_row_id: CalibrationRow['id'] | null;
  experimental_size: ExperimentalMotorcycleSize | null;
  row_assignment_v2: RowAssignmentV2;
}

export interface MetricMotorcycleMapping {
  status: 'READY' | 'CALIBRATION_REQUIRED';
  motorcycles: MetricMotorcycle[];
}
