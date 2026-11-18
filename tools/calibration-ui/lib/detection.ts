import { PARKMAP_API_URL, ParkingApiError } from './api.ts';
import type { DetectionResponse } from '../types/detection.ts';
import type { components } from '../types/api.gen.ts';
import { BYTES_PER_MIB, DEFAULT_CLEARANCE_MARGIN_M, MAX_UPLOAD_MIB, type ParkingDetector } from './parkingSettings.ts';

export async function analyzeParkingSegmentation(file: File, signal?: AbortSignal, includeParking = true, incomingWidth?: number, clearanceMargin = DEFAULT_CLEARANCE_MARGIN_M, segmentationModel: 'configured' | 'yolo26n-seg' = 'configured'): Promise<components['schemas']['ParkingClassifierResult']> {
  const body = new FormData();
  body.set('image', file); body.set('primary_detector', 'segmentation'); body.set('include_parking', String(includeParking));
  body.set('include_segmentation', 'true');
  body.set('include_segmentation_gaps', 'true');
  if (incomingWidth !== undefined) body.set('incoming_width_m', String(incomingWidth));
  body.set('clearance_margin_m', String(clearanceMargin));
  if (segmentationModel !== 'configured') body.set('segmentation_model', segmentationModel);
  const response = await fetch('/api/classifier?op=analyze', { method: 'POST', body, signal });
  const data = await response.json();
  if (!response.ok) throw new ParkingApiError(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : `Image analysis failed (${response.status}).`);
  return data as components['schemas']['ParkingClassifierResult'];
}

type FrameDetection = components['schemas']['FrameDetectionResponse'];

export async function detectMotorcycleFrame(file: File, detector: ParkingDetector, signal: AbortSignal, mode?: FrameDetection['mode']): Promise<FrameDetection> {
  const body = new FormData();
  body.set('image', file);
  if (mode) body.set('mode', mode);
  body.set('detector', detector);
  const response = await fetch('/api/classifier?op=detect-frame', { method: 'POST', body, signal });
  const data = await response.json();
  if (!response.ok) throw new ParkingApiError(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : `Motorcycle detection failed (${response.status}).`);
  const frame = data as Partial<FrameDetection> | null;
  if (!Array.isArray(frame?.detections)
    || (frame.mode !== 'near' && frame.mode !== 'wide')
    || typeof frame.crop_padding_ratio !== 'number' || !Number.isFinite(frame.crop_padding_ratio) || frame.crop_padding_ratio < 0
    || typeof frame.max_selected_boxes !== 'number' || !Number.isSafeInteger(frame.max_selected_boxes) || frame.max_selected_boxes < 1) {
    throw new ParkingApiError('Vision API ส่งข้อมูลการครอปไม่ครบ กรุณารีสตาร์ต Vision API แล้วลองตรวจเฟรมอีกครั้ง');
  }
  return data as FrameDetection;
}

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MIB * BYTES_PER_MIB;

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
