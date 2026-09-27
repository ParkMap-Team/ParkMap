import { PARKMAP_API_URL, ParkingApiError } from './parking.ts';
import type { MetricCalibration, MetricCalibrationResponse } from '../types/metricCalibration.ts';

const metricCalibrationUrl = `${PARKMAP_API_URL.replace(/\/$/, '')}/api/metric-calibration`;

async function readResponse(response: Response): Promise<MetricCalibrationResponse> {
  if (!response.ok) {
    let message = `Unable to process metric calibration (${response.status}).`;
    try {
      const payload = await response.json() as { detail?: string | Array<{ msg?: string }> };
      if (typeof payload.detail === 'string') message = payload.detail;
      else if (Array.isArray(payload.detail)) message = payload.detail.map((item) => item.msg).filter(Boolean).join(' ');
    } catch { /* Retain the status-based message. */ }
    throw new ParkingApiError(message);
  }
  return await response.json() as MetricCalibrationResponse;
}

export async function getMetricCalibration(signal?: AbortSignal): Promise<MetricCalibrationResponse> {
  return readResponse(await fetch(metricCalibrationUrl, { signal, cache: 'no-store', headers: { Accept: 'application/json' } }));
}

export async function saveMetricCalibration(calibration: MetricCalibration, signal?: AbortSignal): Promise<MetricCalibrationResponse> {
  return readResponse(await fetch(metricCalibrationUrl, { method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(calibration) }));
}
