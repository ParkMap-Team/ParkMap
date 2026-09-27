import { buildGroundContactDiagnostics } from './occupancyDiagnostics.ts';
import { deriveRowCenterline, projectPointOntoRow } from './rowProjection.ts';
import type { CalibrationPoint, CalibrationRow, DetectionRowAssignment, ParkingCalibration, RowCenterline } from '../types/calibration.ts';
import type { Detection } from '../types/detection.ts';
import type { MetricCalibrationResponse, MetricMeasurementSource } from '../types/metricCalibration.ts';
import type { MergedOccupiedInterval, OccupiedGap, OccupiedInterval, OccupiedIntervalPrototypeData, OccupiedIntervalSource } from '../types/occupiedIntervals.ts';

export const OCCUPIED_INTERVAL_GROUND_PROXY_RATIO = 0.2 as const;
export const OCCUPIED_INTERVAL_MERGE_EPSILON = 1e-9;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function metricFields(tStart: number, tEnd: number, rowLength: number | null, source: MetricMeasurementSource | null) {
  return rowLength === null
    ? { position_start_m: null, position_end_m: null, metric_source: null }
    : { position_start_m: tStart * rowLength, position_end_m: tEnd * rowLength, metric_source: source };
}

export function projectIntersectionPolygonToInterval(
  polygon: CalibrationPoint[],
  row: CalibrationRow,
  detectionIndex: number,
  sourceType: OccupiedIntervalSource,
  rowLength: number | null = null,
  metricSource: MetricMeasurementSource | null = null,
): { ok: true; interval: OccupiedInterval } | { ok: false; error: string } {
  const centerlineResult = deriveRowCenterline(row.polygon);
  if (!centerlineResult.ok) return { ok: false, error: centerlineResult.error };
  const rawPositions = polygon.flatMap((point) => {
    const result = projectPointOntoRow(point, centerlineResult.centerline);
    return result.ok && Number.isFinite(result.row_position.t_raw) ? [result.row_position.t_raw] : [];
  });
  if (!rawPositions.length) return { ok: false, error: 'MISSING_INTERSECTION_VERTICES' };
  const tStart = clamp01(Math.min(...rawPositions));
  const tEnd = clamp01(Math.max(...rawPositions));
  return { ok: true, interval: {
    row_id: row.id,
    detection_index: detectionIndex,
    source_type: sourceType,
    t_start: Math.min(tStart, tEnd),
    t_end: Math.max(tStart, tEnd),
    ...metricFields(Math.min(tStart, tEnd), Math.max(tStart, tEnd), rowLength, metricSource),
  } };
}

export function mergeOccupiedIntervals(
  intervals: OccupiedInterval[],
  rowId: CalibrationRow['id'],
  rowLength: number | null = null,
  metricSource: MetricMeasurementSource | null = null,
): MergedOccupiedInterval[] {
  const sorted = [...intervals].sort((a, b) => a.t_start - b.t_start || a.t_end - b.t_end || a.detection_index - b.detection_index);
  const merged: MergedOccupiedInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.t_start > previous.t_end + OCCUPIED_INTERVAL_MERGE_EPSILON) {
      merged.push({ row_id: rowId, t_start: interval.t_start, t_end: interval.t_end, detection_indices: [interval.detection_index], source_types: [interval.source_type], ...metricFields(interval.t_start, interval.t_end, rowLength, metricSource) });
      continue;
    }
    previous.t_end = Math.max(previous.t_end, interval.t_end);
    previous.detection_indices = [...new Set([...previous.detection_indices, interval.detection_index])].sort((a, b) => a - b);
    previous.source_types = [...new Set([...previous.source_types, interval.source_type])];
    Object.assign(previous, metricFields(previous.t_start, previous.t_end, rowLength, metricSource));
  }
  return merged;
}

export function calculateOccupiedGaps(
  merged: MergedOccupiedInterval[],
  rowId: CalibrationRow['id'],
  rowLength: number | null = null,
  metricSource: MetricMeasurementSource | null = null,
): OccupiedGap[] {
  const gaps: OccupiedGap[] = [];
  let cursor = 0;
  const addGap = (start: number, end: number) => {
    if (end - start <= OCCUPIED_INTERVAL_MERGE_EPSILON) return;
    gaps.push({ row_id: rowId, t_start: start, t_end: end, normalized_length: end - start, gap_length_m: rowLength === null ? null : (end - start) * rowLength, ...metricFields(start, end, rowLength, metricSource) });
  };
  for (const interval of merged) {
    addGap(cursor, interval.t_start);
    cursor = Math.max(cursor, interval.t_end);
  }
  addGap(cursor, 1);
  return gaps;
}

function interpolate(centerline: RowCenterline, t: number): CalibrationPoint {
  return { x: centerline.start.x + (centerline.end.x - centerline.start.x) * t, y: centerline.start.y + (centerline.end.y - centerline.start.y) * t };
}

export function pointOnOccupiedRow(centerline: RowCenterline, t: number): CalibrationPoint {
  return interpolate(centerline, clamp01(t));
}

export function buildOccupiedIntervalPrototype(
  detections: Detection[],
  assignments: DetectionRowAssignment[],
  calibration: ParkingCalibration,
  metricCalibration: MetricCalibrationResponse | null = null,
): OccupiedIntervalPrototypeData {
  const ground = buildGroundContactDiagnostics(detections, assignments, calibration, OCCUPIED_INTERVAL_GROUND_PROXY_RATIO);
  const rows = calibration.rows.map((row) => ({ row_id: row.id, name: row.name, centerline: deriveRowCenterline(row.polygon), intervals: [] as OccupiedInterval[], merged_intervals: [] as MergedOccupiedInterval[], gaps: [] as OccupiedGap[], contributing_detection_count: 0, obstruction_count: 0, external_obstruction_count: 0, before_external_obstructions: { intervals: [] as OccupiedInterval[], merged_intervals: [] as MergedOccupiedInterval[], gaps: [] as OccupiedGap[], contributing_detection_count: 0, merged_interval_count: 0, gap_count: 0, largest_gap_m: null as number | null } }));
  const unsupported: OccupiedIntervalPrototypeData['unsupported'] = [];
  const ignored: OccupiedIntervalPrototypeData['ignored'] = { outside_roi: [], unassigned_without_row_overlap: [], ambiguous_without_candidate_overlap: [] };
  const measurementSource = metricCalibration?.calibration?.measurement_source ?? null;

  for (const diagnostic of ground.detections) {
    const assignment = assignments.find((item) => item.detection_index === diagnostic.detection_index);
    if (!assignment) { ignored.outside_roi.push(diagnostic.detection_index); continue; }
    let source: OccupiedIntervalSource;
    let overlaps = diagnostic.intersecting_rows;
    if (assignment.status === 'OUTSIDE_ROI') {
      source = 'EXTERNAL_OBSTRUCTION';
      if (!overlaps.length) { ignored.outside_roi.push(diagnostic.detection_index); continue; }
    } else if (assignment.status === 'ASSIGNED') {
      source = 'ASSIGNED';
      overlaps = overlaps.filter((overlap) => overlap.row_id === assignment.row_id);
      if (!overlaps.length) unsupported.push({ detection_index: diagnostic.detection_index, row_id: assignment.row_id, error: 'PRIMARY_ROW_NOT_INTERSECTED' });
    } else if (assignment.status === 'UNASSIGNED') {
      source = 'UNASSIGNED_OBSTRUCTION';
      if (!overlaps.length) ignored.unassigned_without_row_overlap.push(diagnostic.detection_index);
    } else {
      source = 'AMBIGUOUS_OBSTRUCTION';
      overlaps = overlaps.filter((overlap) => assignment.matching_rows.includes(overlap.row_id));
      if (!overlaps.length) ignored.ambiguous_without_candidate_overlap.push(diagnostic.detection_index);
    }
    for (const overlap of overlaps) {
      const row = calibration.rows.find((candidate) => candidate.id === overlap.row_id);
      const bucket = rows.find((candidate) => candidate.row_id === overlap.row_id);
      if (!row || !bucket) { unsupported.push({ detection_index: diagnostic.detection_index, row_id: overlap.row_id, error: 'ROW_NOT_FOUND' }); continue; }
      const measurement = metricCalibration?.calibration?.rows.find((candidate) => candidate.id === row.id);
      const rowLength = measurement && Number.isFinite(measurement.length_m) && measurement.length_m > 0 ? measurement.length_m : null;
      const result = projectIntersectionPolygonToInterval(overlap.intersection_polygon, row, diagnostic.detection_index, source, rowLength, rowLength === null ? null : measurementSource);
      if (result.ok) bucket.intervals.push(result.interval);
      else unsupported.push({ detection_index: diagnostic.detection_index, row_id: row.id, error: result.error });
    }
  }

  for (const bucket of rows) {
    const measurement = metricCalibration?.calibration?.rows.find((candidate) => candidate.id === bucket.row_id);
    const rowLength = measurement && Number.isFinite(measurement.length_m) && measurement.length_m > 0 ? measurement.length_m : null;
    bucket.intervals.sort((a, b) => a.t_start - b.t_start || a.detection_index - b.detection_index);
    bucket.merged_intervals = mergeOccupiedIntervals(bucket.intervals, bucket.row_id, rowLength, rowLength === null ? null : measurementSource);
    bucket.gaps = calculateOccupiedGaps(bucket.merged_intervals, bucket.row_id, rowLength, rowLength === null ? null : measurementSource);
    bucket.contributing_detection_count = new Set(bucket.intervals.map((interval) => interval.detection_index)).size;
    bucket.obstruction_count = bucket.intervals.filter((interval) => interval.source_type !== 'ASSIGNED').length;
    bucket.external_obstruction_count = bucket.intervals.filter((interval) => interval.source_type === 'EXTERNAL_OBSTRUCTION').length;
    const beforeIntervals = bucket.intervals.filter((interval) => interval.source_type !== 'EXTERNAL_OBSTRUCTION');
    const beforeMerged = mergeOccupiedIntervals(beforeIntervals, bucket.row_id, rowLength, rowLength === null ? null : measurementSource);
    const beforeGaps = calculateOccupiedGaps(beforeMerged, bucket.row_id, rowLength, rowLength === null ? null : measurementSource);
    bucket.before_external_obstructions = {
      intervals: beforeIntervals,
      merged_intervals: beforeMerged,
      gaps: beforeGaps,
      contributing_detection_count: new Set(beforeIntervals.map((interval) => interval.detection_index)).size,
      merged_interval_count: beforeMerged.length,
      gap_count: beforeGaps.length,
      largest_gap_m: beforeGaps.every((gap) => gap.gap_length_m === null) ? null : Math.max(0, ...beforeGaps.flatMap((gap) => gap.gap_length_m === null ? [] : [gap.gap_length_m])),
    };
  }
  return { ground_proxy_height_ratio: OCCUPIED_INTERVAL_GROUND_PROXY_RATIO, rows, ignored, unsupported };
}
