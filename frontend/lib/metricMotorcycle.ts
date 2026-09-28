import { getMotorcycleGroundPoint } from './geometry.ts';
import { imageNormalizedToGroundMeters } from './groundPlaneHomography.ts';
import type { DetectionRowAssignment } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { GroundPlaneMetricPoint, GroundPlaneHomographyResponse } from '../types/groundPlaneCalibration.ts';
import type { MetricMotorcycle, MetricMotorcycleMapping } from '../types/metricMotorcycle.ts';
import type { PhysicalRowGeometryResponse } from '../types/physicalRowGeometry.ts';
import { buildMotorcycleFootprint, footprintOverlap, polygonArea, GLOBAL_MOTORCYCLE_DIRECTION } from './motorcycleFootprint';
import { estimateMotorcycleSize } from './motorcycleSizeExperiment';

const EPSILON = 1e-9;

export function parkingMapMotorcycles(mapping: MetricMotorcycleMapping | null): MetricMotorcycle[] {
  return mapping?.motorcycles.filter((item) => item.inside_parking_roi && item.metric_point !== null) ?? [];
}

export function parkingMapRoi(homography: GroundPlaneHomographyResponse | null): GroundPlaneMetricPoint[] {
  return homography?.current === true && homography.status === 'VALIDATED' ? homography.result?.roi_metric?.points ?? [] : [];
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
  imageWidth = 4032,
  imageHeight = 3024,
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
      const globalFootprint = metricPoint ? buildMotorcycleFootprint(metricPoint, { x: -GLOBAL_MOTORCYCLE_DIRECTION.y, y: GLOBAL_MOTORCYCLE_DIRECTION.x }, undefined, undefined, GLOBAL_MOTORCYCLE_DIRECTION) : null;
      const candidates = globalFootprint ? rows.map((row) => ({ row, footprint: globalFootprint, overlap: footprintOverlap(globalFootprint, row.physical_polygon!) })) : [];
      const best = candidates.reduce<typeof candidates[number] | null>((current, candidate) => !current || candidate.overlap.overlap_ratio > current.overlap.overlap_ratio ? candidate : current, null);
      const oriented = imageAssignment.row_id ? candidates.find((candidate) => candidate.row.row_id === imageAssignment.row_id) ?? best : best;
      const positiveOverlaps = candidates.filter((candidate) => candidate.overlap.overlap_ratio > EPSILON);
      const bestDiagnostic = positiveOverlaps.reduce<typeof candidates[number] | null>((current, candidate) => !current || candidate.overlap.overlap_ratio > current.overlap.overlap_ratio ? candidate : current, null);
      const diagnostic = positiveOverlaps.length > 1
        ? 'MULTIPLE_ROW_FOOTPRINT_OVERLAP'
        : positiveOverlaps.length === 0
          ? 'POINT_OUTSIDE_AND_NO_FOOTPRINT_OVERLAP'
          : insideParkingRoi && matchingRows.length > 0
            ? 'POINT_INSIDE_AND_FOOTPRINT_OVERLAPS'
            : 'POINT_OUTSIDE_BUT_FOOTPRINT_OVERLAPS';
      const ranked = [...candidates].sort((a, b) => b.overlap.overlap_ratio - a.overlap.overlap_ratio), bestV2 = ranked[0], secondV2 = ranked[1];
      const bestOverlap = bestV2?.overlap.overlap_ratio ?? 0, secondOverlap = secondV2?.overlap.overlap_ratio ?? 0, margin = bestOverlap - secondOverlap, pointOverlap = imageAssignment.row_id ? candidates.find((c) => c.row.row_id === imageAssignment.row_id)?.overlap.overlap_ratio ?? 0 : 0;
      const strong = bestOverlap >= .6 && margin >= .2;
      const conflict = imageAssignment.row_id !== null && bestV2 && bestV2.row.row_id !== imageAssignment.row_id && bestOverlap >= pointOverlap + .2;
      const v2State = imageAssignment.row_id && !conflict ? 'POINT_ASSIGNED' : conflict ? 'AMBIGUOUS' : strong ? 'FOOTPRINT_ASSIGNED' : bestOverlap > 0 ? 'AMBIGUOUS' : 'UNASSIGNED';
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
        footprint_polygon: oriented?.footprint ?? null,
        footprint_area_m2: oriented ? polygonArea(oriented.footprint) : null,
        footprint_orientation_row_id: oriented?.row.row_id ?? null,
        footprint_candidate_row_id: best?.row.row_id ?? null,
        row_overlaps: candidates.map((candidate) => ({ row_id: candidate.row.row_id, ...candidate.overlap })),
        footprint_diagnostic: diagnostic,
        best_diagnostic_row_id: bestDiagnostic?.row.row_id ?? null,
        experimental_size: metricPoint && matrix ? estimateMotorcycleSize(detection.bbox, imageWidth, imageHeight, matrix) : null,
        row_assignment_v2: { point_row_id: imageAssignment.row_id, assigned_row_id: v2State === 'FOOTPRINT_ASSIGNED' ? bestV2.row.row_id : v2State === 'POINT_ASSIGNED' ? imageAssignment.row_id : null, state: v2State, best_row_id: bestV2?.row.row_id ?? null, best_overlap: bestOverlap, second_row_id: secondV2?.row.row_id ?? null, second_overlap: secondOverlap, overlap_margin: margin, point_row_overlap: pointOverlap, reason: conflict ? 'POINT_FOOTPRINT_CONFLICT' : strong ? 'FOOTPRINT_DOMINANT_SINGLE_ROW' : bestOverlap > 0 ? 'FOOTPRINT_INSUFFICIENT_MARGIN' : 'NO_ROW_OVERLAP' },
      };
    }),
  };
}
