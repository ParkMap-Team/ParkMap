import { PARKMAP_API_URL, ParkingApiError } from './api.ts';
import type { ParkingCalibration } from '../types/calibration.ts';

const calibrationUrl = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/calibration`;

export async function getCalibration(signal?: AbortSignal): Promise<ParkingCalibration | null> {
  const response = await fetch(calibrationUrl, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ParkingApiError(`Unable to load parking calibration (${response.status}).`);
  return await response.json() as ParkingCalibration;
}
