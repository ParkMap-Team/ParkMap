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
