import { PARKMAP_API_URL, ParkingApiError } from '@/lib/parking';
import type { ParkingCalibration } from '@/types/calibration';

const calibrationUrl = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/calibration`;

export async function getCalibration(signal?: AbortSignal): Promise<ParkingCalibration | null> {
  const response = await fetch(calibrationUrl, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new ParkingApiError(`Unable to load parking calibration (${response.status}).`);
  return await response.json() as ParkingCalibration;
}

export async function saveCalibration(calibration: ParkingCalibration, signal?: AbortSignal): Promise<ParkingCalibration> {
  const response = await fetch(calibrationUrl, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(calibration),
  });
  if (!response.ok) {
    let message = `Unable to save parking calibration (${response.status}).`;
    try {
      const payload = await response.json() as { detail?: string | Array<{ msg?: string }> };
      if (typeof payload.detail === 'string') message = payload.detail;
      else if (Array.isArray(payload.detail)) message = payload.detail.map((item) => item.msg).filter(Boolean).join(' ');
    } catch { /* Keep the status-based message for non-JSON responses. */ }
    throw new ParkingApiError(message);
  }
  return await response.json() as ParkingCalibration;
}
