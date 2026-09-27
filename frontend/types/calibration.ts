export interface CalibrationPoint {
  x: number;
  y: number;
}

export interface CalibrationPolygon {
  polygon: CalibrationPoint[];
}

export interface CalibrationRow extends CalibrationPolygon {
  id: `row_${1 | 2 | 3 | 4 | 5}`;
  name: `Parking Row ${1 | 2 | 3 | 4 | 5}`;
}

export interface ParkingCalibration {
  schema_version: 2;
  camera_id: string;
  reference_image: { width: number; height: number };
  parking_roi: CalibrationPolygon;
  rows: CalibrationRow[];
}

export type RowAssignmentStatus = 'ASSIGNED' | 'OUTSIDE_ROI' | 'UNASSIGNED' | 'AMBIGUOUS';

export interface DetectionRowAssignment {
  detection_index: number;
  ground_point: CalibrationPoint;
  status: RowAssignmentStatus;
  row_id: CalibrationRow['id'] | null;
  matching_rows: CalibrationRow['id'][];
}

export interface RowCenterline {
  start: CalibrationPoint;
  end: CalibrationPoint;
}

export type RowGeometryError =
  | 'UNSUPPORTED_VERTEX_COUNT'
  | 'MALFORMED_POLYGON'
  | 'ZERO_LENGTH_CENTERLINE';

export type RowCenterlineResult =
  | { ok: true; centerline: RowCenterline }
  | { ok: false; error: RowGeometryError };

export interface RowPosition {
  t: number;
  t_raw: number;
  projection: CalibrationPoint;
  distance_to_centerline: number;
}

export interface ProjectedMotorcycle {
  detection_index: number;
  row_id: CalibrationRow['id'];
  ground_point: CalibrationPoint;
  row_position: RowPosition;
}

export interface RowProjectionBucket {
  row_id: CalibrationRow['id'];
  name: CalibrationRow['name'];
  centerline: RowCenterlineResult;
  motorcycles: ProjectedMotorcycle[];
}

export interface UnsupportedRowProjection {
  detection_index: number;
  row_id: CalibrationRow['id'] | null;
  error: RowGeometryError | 'MISSING_DETECTION' | 'ASSIGNMENT_ROW_NOT_FOUND';
}

export interface RowOccupancyProjectionData {
  rows: RowProjectionBucket[];
  unassigned: DetectionRowAssignment[];
  ambiguous: DetectionRowAssignment[];
  outside_roi: DetectionRowAssignment[];
  unsupported: UnsupportedRowProjection[];
}
