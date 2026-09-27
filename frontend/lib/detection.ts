import { PARKMAP_API_URL, ParkingApiError } from '@/lib/parking';
import type { DetectionResponse } from '@/types/detection';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function analyzeParkingImage(file: File, signal?: AbortSignal): Promise<DetectionResponse> {
  const formData = new FormData();
  formData.append('image', file);
  const response = await fetch(`${PARKMAP_API_URL.replace(/\/$/, '')}/api/detection/analyze`, {
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
