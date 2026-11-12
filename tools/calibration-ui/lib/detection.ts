import { PARKMAP_API_URL, ParkingApiError } from './api.ts';
import type { DetectionResponse } from '../types/detection.ts';
import type { components } from '../types/api.gen.ts';

export async function analyzeParkingSegmentation(file: File, signal?: AbortSignal, includeParking = true, incomingWidth?: number, clearanceMargin = 0): Promise<components['schemas']['ParkingClassifierResult']> {
  const body = new FormData();
  body.set('image', file); body.set('primary_detector', 'segmentation'); body.set('include_parking', String(includeParking));
  body.set('include_segmentation', 'true');
  body.set('include_segmentation_gaps', 'true');
  if (incomingWidth !== undefined) body.set('incoming_width_m', String(incomingWidth));
  body.set('clearance_margin_m', String(clearanceMargin));
  const response = await fetch('/api/classifier?op=analyze', { method: 'POST', body, signal });
  const data = await response.json();
  if (!response.ok) throw new ParkingApiError(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : `Image analysis failed (${response.status}).`);
  return data as components['schemas']['ParkingClassifierResult'];
}

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function analyzeParkingImage(file: File, signal?: AbortSignal, includeParking = true): Promise<DetectionResponse> {
  const formData = new FormData();
  formData.append('image', file);
  const url = new URL(`${PARKMAP_API_URL.replace(/\/$/, '')}/api/detection/analyze`);
  if (!includeParking) url.searchParams.set('include_parking', 'false');
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    let message = `Image analysis failed (${response.status}).`;
    try {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch { /* Keep the status-based fallback for non-JSON errors. */ }
    throw new ParkingApiError(message);
  }
  return await response.json() as DetectionResponse;
}
