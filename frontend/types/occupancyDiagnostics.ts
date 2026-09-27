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

export type GroundProxyHeightRatio = 0.1 | 0.2 | 0.3;

export interface GroundProxyRowOverlap {
  row_id: CalibrationRow['id'];
  intersection_area_normalized: number;
  proxy_overlap_ratio: number;
  intersection_polygon: CalibrationPoint[];
}

export interface GroundContactDiagnostic {
  detection_index: number;
  primary_assignment: { status: RowAssignmentStatus; row_id: CalibrationRow['id'] | null };
  proxy_bbox: { x: number; y: number; width: number; height: number } | null;
  proxy_intersects_parking_roi: boolean;
  parking_roi_proxy_overlap_ratio: number;
  parking_roi_intersection_polygon: CalibrationPoint[];
  intersecting_rows: GroundProxyRowOverlap[];
  geometry_error: 'MALFORMED_BBOX' | 'INVALID_HEIGHT_RATIO' | 'MALFORMED_PARKING_ROI' | null;
}

export interface OutsideRoiProxyDiagnosticsData {
  height_ratio: 0.2;
  detections: GroundContactDiagnostic[];
  total: number;
  proxy_intersects_parking_roi: number;
  proxy_does_not_intersect_parking_roi: number;
  proxy_intersects_at_least_one_row: number;
  affected_by_row: Record<CalibrationRow['id'], number>;
  proxy_intersects_multiple_rows: number;
}

export interface GroundContactDiagnosticsData {
  height_ratio: number;
  detections: GroundContactDiagnostic[];
  assigned_total: number;
  unassigned_total: number;
  assigned_proxy_intersects_primary: number;
  assigned_proxy_intersects_neighbor: number;
  unassigned_with_proxy_row_overlap: number;
  proxy_overlapping_multiple_rows: number;
}
