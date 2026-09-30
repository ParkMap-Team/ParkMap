import { getMotorcycleGroundPoint, pointInPolygon } from './geometry.ts';
import type { DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';

export function assignDetectionToParkingRow(
  detection: Detection,
  calibration: ParkingCalibration,
  detectionIndex = 0,
): DetectionRowAssignment {
  const groundPoint = getMotorcycleGroundPoint(detection.bbox);
  if (!pointInPolygon(groundPoint, calibration.parking_roi.polygon)) {
    return {
      detection_index: detectionIndex,
      ground_point: groundPoint,
      status: 'OUTSIDE_ROI',
      row_id: null,
      matching_rows: [],
    };
  }

  const matchingRows = calibration.rows
    .filter((row) => pointInPolygon(groundPoint, row.polygon))
    .map((row) => row.id);

  if (matchingRows.length === 1) {
    return {
      detection_index: detectionIndex,
      ground_point: groundPoint,
      status: 'ASSIGNED',
      row_id: matchingRows[0],
      matching_rows: matchingRows,
    };
  }

  return {
    detection_index: detectionIndex,
    ground_point: groundPoint,
    status: matchingRows.length === 0 ? 'UNASSIGNED' : 'AMBIGUOUS',
    row_id: null,
    matching_rows: matchingRows,
  };
}

export function assignDetectionsToParkingRows(
  detections: Detection[],
  calibration: ParkingCalibration,
): DetectionRowAssignment[] {
  return detections.map((detection, index) => assignDetectionToParkingRow(detection, calibration, index));
}

export function hasSignificantAspectRatioMismatch(
  imageWidth: number,
  imageHeight: number,
  calibration: ParkingCalibration,
  tolerance = 0.01,
): boolean {
  const imageAspectRatio = imageWidth / imageHeight;
  const referenceAspectRatio = calibration.reference_image.width / calibration.reference_image.height;
  return Math.abs(imageAspectRatio / referenceAspectRatio - 1) > tolerance;
}
