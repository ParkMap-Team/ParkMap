import { pointInPolygon } from './geometry.ts';
import type { CalibrationPoint, CalibrationRow, DetectionRowAssignment, ParkingCalibration } from '../types/calibration.ts';
import type { Detection, DetectionBBox } from '../types/detection.ts';
import type { GroundContactDiagnostic, GroundContactDiagnosticsData, OutsideRoiProxyDiagnosticsData, VisualOccupancyDiagnostic, VisualOccupancyDiagnosticsData, VisualRowOverlap } from '../types/occupancyDiagnostics.ts';

const EPSILON = 1e-12;

const finitePoint = (point: CalibrationPoint | undefined): point is CalibrationPoint => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));

export function polygonArea(polygon: CalibrationPoint[]): number {
  if (polygon.length < 3 || !polygon.every(finitePoint)) return 0;
  return Math.abs(polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function bboxToPolygon(bbox: DetectionBBox): { ok: true; polygon: CalibrationPoint[]; area: number } | { ok: false; error: 'MALFORMED_BBOX' } {
  const values = [bbox.x, bbox.y, bbox.width, bbox.height];
  if (!values.every(Number.isFinite) || bbox.x < 0 || bbox.y < 0 || bbox.width <= 0 || bbox.height <= 0 || bbox.x + bbox.width > 1 + EPSILON || bbox.y + bbox.height > 1 + EPSILON) return { ok: false, error: 'MALFORMED_BBOX' };
  return { ok: true, area: bbox.width * bbox.height, polygon: [
    { x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height }, { x: bbox.x, y: bbox.y + bbox.height },
  ] };
}

function clipBoundary(
  polygon: CalibrationPoint[],
  inside: (point: CalibrationPoint) => boolean,
  intersection: (start: CalibrationPoint, end: CalibrationPoint) => CalibrationPoint,
): CalibrationPoint[] {
  if (!polygon.length) return [];
  const output: CalibrationPoint[] = [];
  let start = polygon[polygon.length - 1];
  for (const end of polygon) {
    const startInside = inside(start); const endInside = inside(end);
    if (endInside) { if (!startInside) output.push(intersection(start, end)); output.push(end); }
    else if (startInside) output.push(intersection(start, end));
    start = end;
  }
  return output;
}

export function clipPolygonToBbox(polygon: CalibrationPoint[], bbox: DetectionBBox): CalibrationPoint[] {
  const left = bbox.x; const right = bbox.x + bbox.width; const top = bbox.y; const bottom = bbox.y + bbox.height;
  let clipped = polygon.map((point) => ({ ...point }));
  clipped = clipBoundary(clipped, (point) => point.x >= left - EPSILON, (a, b) => ({ x: left, y: a.y + (b.y - a.y) * (left - a.x) / (b.x - a.x) }));
  clipped = clipBoundary(clipped, (point) => point.x <= right + EPSILON, (a, b) => ({ x: right, y: a.y + (b.y - a.y) * (right - a.x) / (b.x - a.x) }));
  clipped = clipBoundary(clipped, (point) => point.y >= top - EPSILON, (a, b) => ({ x: a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y), y: top }));
  return clipBoundary(clipped, (point) => point.y <= bottom + EPSILON, (a, b) => ({ x: a.x + (b.x - a.x) * (bottom - a.y) / (b.y - a.y), y: bottom }));
}

function orientation(a: CalibrationPoint, b: CalibrationPoint, c: CalibrationPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(value: number, a: number, b: number): boolean { return value >= Math.min(a, b) - EPSILON && value <= Math.max(a, b) + EPSILON; }
function segmentsIntersect(a: CalibrationPoint, b: CalibrationPoint, c: CalibrationPoint, d: CalibrationPoint): boolean {
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d); const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return (Math.abs(o1) <= EPSILON && between(c.x, a.x, b.x) && between(c.y, a.y, b.y))
    || (Math.abs(o2) <= EPSILON && between(d.x, a.x, b.x) && between(d.y, a.y, b.y))
    || (Math.abs(o3) <= EPSILON && between(a.x, c.x, d.x) && between(a.y, c.y, d.y))
    || (Math.abs(o4) <= EPSILON && between(b.x, c.x, d.x) && between(b.y, c.y, d.y));
}

function polygonsIntersect(a: CalibrationPoint[], b: CalibrationPoint[]): boolean {
  if (a.some((point) => pointInPolygon(point, b)) || b.some((point) => pointInPolygon(point, a))) return true;
  return a.some((start, index) => b.some((otherStart, otherIndex) => segmentsIntersect(start, a[(index + 1) % a.length], otherStart, b[(otherIndex + 1) % b.length])));
}

export function intersectBboxWithPolygon(bbox: DetectionBBox, polygon: CalibrationPoint[]):
  | { ok: true; intersects: boolean; intersection_area_normalized: number; bbox_overlap_ratio: number; intersection_polygon: CalibrationPoint[] }
  | { ok: false; error: 'MALFORMED_BBOX' | 'MALFORMED_POLYGON' } {
  const rectangle = bboxToPolygon(bbox);
  if (!rectangle.ok) return rectangle;
  if (polygon.length < 3 || !polygon.every((point) => finitePoint(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) || polygonArea(polygon) <= EPSILON) return { ok: false, error: 'MALFORMED_POLYGON' };
  const intersectionPolygon = clipPolygonToBbox(polygon, bbox);
  const area = polygonArea(intersectionPolygon);
  return { ok: true, intersects: area > EPSILON || polygonsIntersect(rectangle.polygon, polygon), intersection_area_normalized: area, bbox_overlap_ratio: area / rectangle.area, intersection_polygon: intersectionPolygon };
}

export function buildVisualOccupancyDiagnostics(detections: Detection[], assignments: DetectionRowAssignment[], calibration: ParkingCalibration): VisualOccupancyDiagnosticsData {
  const diagnostics: VisualOccupancyDiagnostic[] = detections.map((detection, detectionIndex) => {
    const assignment = assignments.find((item) => item.detection_index === detectionIndex);
    const primary = assignment ? { status: assignment.status, row_id: assignment.row_id } : { status: 'OUTSIDE_ROI' as const, row_id: null };
    const bboxResult = bboxToPolygon(detection.bbox);
    if (!bboxResult.ok) return { detection_index: detectionIndex, primary_assignment: primary, bbox_polygon: [], bbox_intersects_parking_roi: false, parking_roi_bbox_overlap_ratio: 0, intersecting_rows: [], geometry_error: bboxResult.error };
    const roi = intersectBboxWithPolygon(detection.bbox, calibration.parking_roi.polygon);
    if (!roi.ok) return { detection_index: detectionIndex, primary_assignment: primary, bbox_polygon: bboxResult.polygon, bbox_intersects_parking_roi: false, parking_roi_bbox_overlap_ratio: 0, intersecting_rows: [], geometry_error: 'MALFORMED_PARKING_ROI' as const };
    const rows: VisualRowOverlap[] = roi.intersects ? calibration.rows.flatMap((row) => {
      const overlap = intersectBboxWithPolygon(detection.bbox, row.polygon);
      return overlap.ok && overlap.intersects ? [{ row_id: row.id, intersection_area_normalized: overlap.intersection_area_normalized, bbox_overlap_ratio: overlap.bbox_overlap_ratio, intersection_polygon: overlap.intersection_polygon }] : [];
    }) : [];
    return { detection_index: detectionIndex, primary_assignment: primary, bbox_polygon: bboxResult.polygon, bbox_intersects_parking_roi: roi.intersects, parking_roi_bbox_overlap_ratio: roi.bbox_overlap_ratio, intersecting_rows: rows, geometry_error: null };
  });
  const unassigned = diagnostics.filter((item) => item.primary_assignment.status === 'UNASSIGNED');
  return {
    detections: diagnostics,
    primary_inside_roi: diagnostics.filter((item) => item.primary_assignment.status !== 'OUTSIDE_ROI').length,
    unassigned: unassigned.length,
    unassigned_with_visual_row_overlap: unassigned.filter((item) => item.intersecting_rows.length > 0).length,
    unassigned_without_visual_row_overlap: unassigned.filter((item) => item.intersecting_rows.length === 0).length,
    visually_overlapping_multiple_rows: diagnostics.filter((item) => item.intersecting_rows.length > 1).length,
  };
}

export function createGroundContactProxy(bbox: DetectionBBox, heightRatio: number):
  | { ok: true; proxy: DetectionBBox }
  | { ok: false; error: 'MALFORMED_BBOX' | 'INVALID_HEIGHT_RATIO' } {
  if (!Number.isFinite(heightRatio) || heightRatio <= 0 || heightRatio > 1) return { ok: false, error: 'INVALID_HEIGHT_RATIO' };
  const rectangle = bboxToPolygon(bbox);
  if (!rectangle.ok) return rectangle;
  const proxyHeight = bbox.height * heightRatio;
  return { ok: true, proxy: { x: bbox.x, y: bbox.y + bbox.height - proxyHeight, width: bbox.width, height: proxyHeight } };
}

export function buildGroundContactDiagnostics(detections: Detection[], assignments: DetectionRowAssignment[], calibration: ParkingCalibration, heightRatio: number): GroundContactDiagnosticsData {
  const diagnostics: GroundContactDiagnostic[] = detections.map((detection, detectionIndex) => {
    const assignment = assignments.find((item) => item.detection_index === detectionIndex);
    const primary = assignment ? { status: assignment.status, row_id: assignment.row_id } : { status: 'OUTSIDE_ROI' as const, row_id: null };
    const proxyResult = createGroundContactProxy(detection.bbox, heightRatio);
    if (!proxyResult.ok) return { detection_index: detectionIndex, primary_assignment: primary, proxy_bbox: null, proxy_intersects_parking_roi: false, parking_roi_proxy_overlap_ratio: 0, parking_roi_intersection_polygon: [], intersecting_rows: [], geometry_error: proxyResult.error };
    const roi = intersectBboxWithPolygon(proxyResult.proxy, calibration.parking_roi.polygon);
    if (!roi.ok) return { detection_index: detectionIndex, primary_assignment: primary, proxy_bbox: proxyResult.proxy, proxy_intersects_parking_roi: false, parking_roi_proxy_overlap_ratio: 0, parking_roi_intersection_polygon: [], intersecting_rows: [], geometry_error: 'MALFORMED_PARKING_ROI' as const };
    const rows = roi.intersects ? calibration.rows.flatMap((row) => {
      const overlap = intersectBboxWithPolygon(proxyResult.proxy, row.polygon);
      return overlap.ok && overlap.intersects ? [{ row_id: row.id, intersection_area_normalized: overlap.intersection_area_normalized, proxy_overlap_ratio: overlap.bbox_overlap_ratio, intersection_polygon: overlap.intersection_polygon }] : [];
    }) : [];
    return { detection_index: detectionIndex, primary_assignment: primary, proxy_bbox: proxyResult.proxy, proxy_intersects_parking_roi: roi.intersects, parking_roi_proxy_overlap_ratio: roi.bbox_overlap_ratio, parking_roi_intersection_polygon: roi.intersection_polygon, intersecting_rows: rows, geometry_error: null };
  });
  const assigned = diagnostics.filter((item) => item.primary_assignment.status === 'ASSIGNED');
  const unassigned = diagnostics.filter((item) => item.primary_assignment.status === 'UNASSIGNED');
  return {
    height_ratio: heightRatio,
    detections: diagnostics,
    assigned_total: assigned.length,
    unassigned_total: unassigned.length,
    assigned_proxy_intersects_primary: assigned.filter((item) => item.intersecting_rows.some((row) => row.row_id === item.primary_assignment.row_id)).length,
    assigned_proxy_intersects_neighbor: assigned.filter((item) => item.intersecting_rows.some((row) => row.row_id !== item.primary_assignment.row_id)).length,
    unassigned_with_proxy_row_overlap: unassigned.filter((item) => item.intersecting_rows.length > 0).length,
    proxy_overlapping_multiple_rows: diagnostics.filter((item) => item.intersecting_rows.length > 1).length,
  };
}

export function buildOutsideRoiProxyDiagnostics(detections: Detection[], assignments: DetectionRowAssignment[], calibration: ParkingCalibration): OutsideRoiProxyDiagnosticsData {
  const outside = buildGroundContactDiagnostics(detections, assignments, calibration, .2).detections.filter((item) => item.primary_assignment.status === 'OUTSIDE_ROI');
  const affected = (rowId: CalibrationRow['id']) => outside.filter((item) => item.intersecting_rows.some((row) => row.row_id === rowId)).length;
  return { height_ratio: .2, detections: outside, total: outside.length, proxy_intersects_parking_roi: outside.filter((item) => item.proxy_intersects_parking_roi).length, proxy_does_not_intersect_parking_roi: outside.filter((item) => !item.proxy_intersects_parking_roi).length, proxy_intersects_at_least_one_row: outside.filter((item) => item.intersecting_rows.length > 0).length, affected_by_row: { row_1: affected('row_1'), row_2: affected('row_2'), row_3: affected('row_3'), row_4: affected('row_4'), row_5: affected('row_5') }, proxy_intersects_multiple_rows: outside.filter((item) => item.intersecting_rows.length > 1).length };
}
