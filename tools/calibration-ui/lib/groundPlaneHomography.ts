import type { CalibrationPoint, ParkingCalibration } from '../types/calibration.ts';
import type { GroundPlaneCalibration, GroundPlaneCalibrationResponse, GroundPlaneHomographyResponse, GroundPlaneMetricPoint } from '../types/groundPlaneCalibration.ts';
import { PARKMAP_API_URL, ParkingApiError } from './api.ts';

export type HomographyMatrix = number[][];

const homographyUrl = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/ground-plane/homography`;
const calibrationUrl = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/ground-plane-calibration`;

async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new ParkingApiError(`${label} (${response.status}).`);
  return await response.json() as T;
}

export async function getGroundPlaneCalibration(signal?: AbortSignal): Promise<GroundPlaneCalibrationResponse> {
  return readJson(await fetch(calibrationUrl, { signal, cache: 'no-store' }), 'Unable to load ground calibration');
}

export async function saveGroundPlaneCalibration(calibration: GroundPlaneCalibration, signal?: AbortSignal): Promise<GroundPlaneCalibrationResponse> {
  return readJson(await fetch(calibrationUrl, { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(calibration) }), 'Unable to save ground calibration');
}

export async function calculateGroundPlaneHomography(signal?: AbortSignal): Promise<GroundPlaneHomographyResponse> {
  return readJson(await fetch(`${homographyUrl}/calculate`, { method: 'POST', signal, headers: { Accept: 'application/json' } }), 'Unable to calculate map calibration');
}

export async function getGroundPlaneHomography(signal?: AbortSignal): Promise<GroundPlaneHomographyResponse> {
  const response = await fetch(homographyUrl, { signal, cache: 'no-store' });
  if (!response.ok) throw new ParkingApiError(`Unable to load map calibration (${response.status}).`);
  return await response.json() as GroundPlaneHomographyResponse;
}

export function imageNormalizedToGroundMeters(x: number, y: number, matrix: HomographyMatrix): GroundPlaneMetricPoint | null {
  if (matrix.length !== 3 || matrix.some((row) => row.length !== 3) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) return null;
  const x_m = (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator;
  const y_m = (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator;
  return Number.isFinite(x_m) && Number.isFinite(y_m) ? { x_m, y_m } : null;
}

export function transformPolygon(points: CalibrationPoint[], matrix: HomographyMatrix): GroundPlaneMetricPoint[] | null {
  const transformed = points.map((point) => imageNormalizedToGroundMeters(point.x, point.y, matrix));
  return transformed.some((point) => point === null) ? null : transformed as GroundPlaneMetricPoint[];
}

export function transformParkingCalibration(calibration: ParkingCalibration, matrix: HomographyMatrix) {
  return {
    roi: transformPolygon(calibration.parking_roi.polygon, matrix),
    rows: calibration.rows.map((row) => ({ id: row.id, points: transformPolygon(row.polygon, matrix) })),
  };
}
