import type {
  CalibrationPoint,
  CalibrationRow,
  DetectionRowAssignment,
  ParkingCalibration,
  RowCenterline,
  RowCenterlineResult,
  RowOccupancyProjectionData,
  RowPosition,
} from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';

const EPSILON = 1e-12;

const finitePoint = (point: CalibrationPoint | undefined): point is CalibrationPoint =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
const distanceSquared = (a: CalibrationPoint, b: CalibrationPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const midpoint = (a: CalibrationPoint, b: CalibrationPoint): CalibrationPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Derives the middle axis of a quadrilateral whose vertices are in cyclic boundary order. */
export function deriveRowCenterline(polygon: CalibrationPoint[]): RowCenterlineResult {
  if (polygon.length !== 4) return { ok: false, error: 'UNSUPPORTED_VERTEX_COUNT' };
  if (!polygon.every(finitePoint)) return { ok: false, error: 'MALFORMED_POLYGON' };

  const areaTwice = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(areaTwice) <= EPSILON) return { ok: false, error: 'MALFORMED_POLYGON' };

  const edges = polygon.map((point, index) => [point, polygon[(index + 1) % 4]] as const);
  const pair02 = distanceSquared(...edges[0]) + distanceSquared(...edges[2]);
  const pair13 = distanceSquared(...edges[1]) + distanceSquared(...edges[3]);
  const [sideA, sideB] = pair02 >= pair13 ? [edges[0], edges[2]] : [edges[1], edges[3]];

  const directCost = distanceSquared(sideA[0], sideB[0]) + distanceSquared(sideA[1], sideB[1]);
  const crossedCost = distanceSquared(sideA[0], sideB[1]) + distanceSquared(sideA[1], sideB[0]);
  let start = directCost <= crossedCost ? midpoint(sideA[0], sideB[0]) : midpoint(sideA[0], sideB[1]);
  let end = directCost <= crossedCost ? midpoint(sideA[1], sideB[1]) : midpoint(sideA[1], sideB[0]);

  if (distanceSquared(start, end) <= EPSILON) return { ok: false, error: 'ZERO_LENGTH_CENTERLINE' };
  if (start.x > end.x || (Math.abs(start.x - end.x) <= EPSILON && start.y > end.y)) [start, end] = [end, start];
  return { ok: true, centerline: { start, end } };
}

export function projectPointOntoRow(point: CalibrationPoint, centerline: RowCenterline):
  | { ok: true; row_position: RowPosition }
  | { ok: false; error: 'INVALID_POINT' | 'ZERO_LENGTH_CENTERLINE' } {
  if (!finitePoint(point) || !finitePoint(centerline.start) || !finitePoint(centerline.end)) return { ok: false, error: 'INVALID_POINT' };
  const vx = centerline.end.x - centerline.start.x;
  const vy = centerline.end.y - centerline.start.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared <= EPSILON) return { ok: false, error: 'ZERO_LENGTH_CENTERLINE' };
  const tRaw = ((point.x - centerline.start.x) * vx + (point.y - centerline.start.y) * vy) / lengthSquared;
  const t = Math.min(1, Math.max(0, tRaw));
  const projection = { x: centerline.start.x + t * vx, y: centerline.start.y + t * vy };
  return {
    ok: true,
    row_position: {
      t,
      t_raw: tRaw,
      projection,
      distance_to_centerline: Math.hypot(point.x - projection.x, point.y - projection.y),
    },
  };
}

export function calculateRowPosition(
  assignment: DetectionRowAssignment,
  row: CalibrationRow,
): { ok: true; row_position: RowPosition; centerline: RowCenterline } | { ok: false; error: string } {
  if (assignment.status !== 'ASSIGNED' || assignment.row_id !== row.id) return { ok: false, error: 'NOT_ASSIGNED_TO_ROW' };
  const centerlineResult = deriveRowCenterline(row.polygon);
  if (!centerlineResult.ok) return centerlineResult;
  const projected = projectPointOntoRow(assignment.ground_point, centerlineResult.centerline);
  return projected.ok ? { ...projected, centerline: centerlineResult.centerline } : projected;
}

export function buildRowOccupancyProjection(
  detections: Detection[],
  assignments: DetectionRowAssignment[],
  calibration: ParkingCalibration,
): RowOccupancyProjectionData {
  const rows: RowOccupancyProjectionData['rows'] = calibration.rows.map((row) => ({
    row_id: row.id,
    name: row.name,
    centerline: deriveRowCenterline(row.polygon),
    motorcycles: [],
  }));
  const result: RowOccupancyProjectionData = {
    rows,
    unassigned: assignments.filter((item) => item.status === 'UNASSIGNED'),
    ambiguous: assignments.filter((item) => item.status === 'AMBIGUOUS'),
    outside_roi: assignments.filter((item) => item.status === 'OUTSIDE_ROI'),
    unsupported: [],
  };

  for (const assignment of assignments) {
    if (assignment.status !== 'ASSIGNED') continue;
    if (!detections[assignment.detection_index]) {
      result.unsupported.push({ detection_index: assignment.detection_index, row_id: assignment.row_id, error: 'MISSING_DETECTION' });
      continue;
    }
    const rowIndex = calibration.rows.findIndex((row) => row.id === assignment.row_id);
    if (rowIndex < 0) {
      result.unsupported.push({ detection_index: assignment.detection_index, row_id: assignment.row_id, error: 'ASSIGNMENT_ROW_NOT_FOUND' });
      continue;
    }
    const bucket = rows[rowIndex];
    if (!bucket.centerline.ok) {
      result.unsupported.push({ detection_index: assignment.detection_index, row_id: assignment.row_id, error: bucket.centerline.error });
      continue;
    }
    const projected = projectPointOntoRow(assignment.ground_point, bucket.centerline.centerline);
    if (!projected.ok) {
      result.unsupported.push({ detection_index: assignment.detection_index, row_id: assignment.row_id, error: 'ZERO_LENGTH_CENTERLINE' });
      continue;
    }
    bucket.motorcycles.push({ detection_index: assignment.detection_index, row_id: bucket.row_id, ground_point: { ...assignment.ground_point }, row_position: projected.row_position });
  }
  for (const bucket of rows) bucket.motorcycles.sort((a, b) => {
    const positionDifference = a.row_position.t - b.row_position.t;
    return Math.abs(positionDifference) <= 1e-9 ? a.detection_index - b.detection_index : positionDifference;
  });
  return result;
}
