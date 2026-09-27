import type { CalibrationPoint, CalibrationRow, RowAssignmentStatus } from './calibration';

export interface VisualRowOverlap {
  row_id: CalibrationRow['id'];
  intersection_area_normalized: number;
  bbox_overlap_ratio: number;
  intersection_polygon: CalibrationPoint[];
}

export interface VisualOccupancyDiagnostic {
  detection_index: number;
  primary_assignment: { status: RowAssignmentStatus; row_id: CalibrationRow['id'] | null };
  bbox_polygon: CalibrationPoint[];
  bbox_intersects_parking_roi: boolean;
  parking_roi_bbox_overlap_ratio: number;
  intersecting_rows: VisualRowOverlap[];
  geometry_error: 'MALFORMED_BBOX' | 'MALFORMED_PARKING_ROI' | null;
}

export interface VisualOccupancyDiagnosticsData {
  detections: VisualOccupancyDiagnostic[];
  primary_inside_roi: number;
  unassigned: number;
  unassigned_with_visual_row_overlap: number;
  unassigned_without_visual_row_overlap: number;
  visually_overlapping_multiple_rows: number;
}
