import { getMotorcycleGroundPoint } from './geometry.ts';
import { imageNormalizedToGroundMeters } from './groundPlaneHomography.ts';
import type { DetectionRowAssignment } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { GroundPlaneMetricPoint, GroundPlaneHomographyResponse } from '../types/groundPlaneCalibration.ts';
import type { MetricMotorcycle, MetricMotorcycleMapping } from '../types/metricMotorcycle.ts';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry.ts';

const EPSILON = 1e-9;

export function parkingMapMotorcycles(mapping: MetricMotorcycleMapping | null): MetricMotorcycle[] {
  return mapping?.motorcycles.filter((item) => item.inside_parking_roi && item.metric_point !== null) ?? [];
}

export function metricPointInPolygon(point: GroundPlaneMetricPoint, polygon: GroundPlaneMetricPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current], b = polygon[previous];
    const cross = (point.y_m - a.y_m) * (b.x_m - a.x_m) - (point.x_m - a.x_m) * (b.y_m - a.y_m);
    const onEdge = Math.abs(cross) <= EPSILON
      && point.x_m >= Math.min(a.x_m, b.x_m) - EPSILON
      && point.x_m <= Math.max(a.x_m, b.x_m) + EPSILON
      && point.y_m >= Math.min(a.y_m, b.y_m) - EPSILON
      && point.y_m <= Math.max(a.y_m, b.y_m) + EPSILON;
    if (onEdge) return true;
    const crosses = (a.y_m > point.y_m) !== (b.y_m > point.y_m)
      && point.x_m < ((b.x_m - a.x_m) * (point.y_m - a.y_m)) / (b.y_m - a.y_m) + a.x_m;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function buildMetricMotorcycleMapping(
  detections: Detection[],
  assignments: DetectionRowAssignment[],
  homography: GroundPlaneHomographyResponse | null,
  physical: PhysicalRowGeometryResponse | null,
): MetricMotorcycleMapping {
  const ready = homography?.current === true
    && homography.status === 'VALIDATED'
    && homography.result !== null
    && physical?.status === 'CURRENT'
    && physical.rows.every((row) => row.status === 'PHYSICAL_READY' && row.physical_polygon);
  const matrix = ready ? homography.result!.matrix : null;
  const rows = ready ? physical!.rows : [];

  return {
    status: ready ? 'READY' : 'CALIBRATION_REQUIRED',
    motorcycles: detections.map((detection, index) => {
      const imageGroundPoint = getMotorcycleGroundPoint(detection.bbox);
      const imageAssignment = assignments[index] ?? {
        detection_index: index,
        ground_point: imageGroundPoint,
        status: 'OUTSIDE_ROI' as const,
        row_id: null,
        matching_rows: [],
      };
      const insideParkingRoi = imageAssignment.status !== 'OUTSIDE_ROI';
      const metricPoint = matrix && insideParkingRoi ? imageNormalizedToGroundMeters(imageGroundPoint.x, imageGroundPoint.y, matrix) : null;
      const matchingRows = metricPoint
        ? rows.filter((row) => row.physical_polygon && metricPointInPolygon(metricPoint, row.physical_polygon)).map((row) => row.row_id)
        : [];
      const containment = matchingRows.length === 1
        ? 'INSIDE_PHYSICAL_ROW'
        : matchingRows.length > 1
          ? 'MULTIPLE_PHYSICAL_ROWS'
          : 'OUTSIDE_PHYSICAL_ROWS';
      const physicalRowId = matchingRows.length === 1 ? matchingRows[0] : null;
      const assignmentMatches = imageAssignment.row_id === physicalRowId
        && (physicalRowId !== null || imageAssignment.status !== 'ASSIGNED');
      return {
        detection_id: `detection-${index + 1}`,
        detection_index: index,
        confidence: detection.confidence,
        bbox: detection.bbox,
        image_ground_point: imageGroundPoint,
        inside_parking_roi: insideParkingRoi,
        metric_point: metricPoint,
        transform_valid: metricPoint !== null,
        image_row_assignment: imageAssignment,
        physical_containment: containment,
        physical_row_id: physicalRowId,
        matching_physical_rows: matchingRows,
        assignment_comparison: assignmentMatches ? 'MATCH' : 'MISMATCH',
      };
    }),
  };
}
