import { CROP_PREVIEW_JPEG_QUALITY, CROP_PREVIEW_MAX_SIDE_PX, CROP_RANK_REFERENCE_SIDE_PX, CROP_RANK_SIZE_BONUS, FRAME_JPEG_QUALITY, MAX_FRAME_CANDIDATES, MAX_VIDEO_FRAMES, VIDEO_FRAME_INTERVAL_SECONDS, VIDEO_FRAME_WAIT_MS } from './parkingSettings.ts';

export function filterFrameDetections<T extends { confidence: number }>(detections: readonly T[], minimumPercent: number): T[] {
  return detections.filter(detection => detection.confidence >= minimumPercent / 100);
}

export function frameCropKey(frameId: string, cropId: number) {
  return `${frameId}:${cropId}`;
}

export function reviewFrameCrops<T extends { confidence: number }, F extends { id: string; previews: readonly T[] }>(
  frames: readonly F[], minimumPercent: number,
) {
  return frames.map(frame => ({
    frame,
    crops: filterFrameDetections(frame.previews.map((crop, index) => ({
      ...crop, id: index + 1, key: frameCropKey(frame.id, index + 1),
    })), minimumPercent),
  }));
}

type FrameBox = { x: number; y: number; width: number; height: number };

export async function cropFramePreviews(image: Blob, boxes: readonly FrameBox[], paddingRatio: number): Promise<string[]> {
  if (!boxes.length) return [];
  const source = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('ไม่สามารถสร้างภาพ Crop ได้');

    return boxes.map(box => {
      const paddingX = box.width * paddingRatio;
      const paddingY = box.height * paddingRatio;
      const left = Math.max(0, Math.floor((box.x - paddingX) * source.width));
      const top = Math.max(0, Math.floor((box.y - paddingY) * source.height));
      const width = Math.min(source.width, Math.ceil((box.x + box.width + paddingX) * source.width)) - left;
      const height = Math.min(source.height, Math.ceil((box.y + box.height + paddingY) * source.height)) - top;
      const scale = Math.min(1, CROP_PREVIEW_MAX_SIDE_PX / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', CROP_PREVIEW_JPEG_QUALITY);
    });
  } finally {
    source.close();
  }
}

export function frameCandidateTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(MAX_FRAME_CANDIDATES, Math.max(1, Math.floor(duration)));
  return Array.from({ length: count }, (_, index) => duration * (index + 0.5) / count);
}

export function frameCandidateScore(detections: readonly { confidence: number; bbox: FrameBox }[], width: number, height: number): number {
  return Math.max(0, ...detections.map(({ confidence, bbox }) => {
    const shorterSide = Math.min(bbox.width * width, bbox.height * height);
    const sizeBonus = CROP_RANK_SIZE_BONUS * Math.min(shorterSide / CROP_RANK_REFERENCE_SIDE_PX, 1);
    return confidence * (1 + sizeBonus);
  }));
}

export function waitForVideoFrame(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal, update: () => void): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const finish = (error?: unknown) => {
      clearTimeout(timeout);
      listeners.abort();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('หมดเวลารอเฟรมวิดีโอ')), VIDEO_FRAME_WAIT_MS);
    const options = { once: true, signal: listeners.signal };
    video.addEventListener(event, () => finish(), options);
    video.addEventListener('error', () => finish(new Error('อ่านเฟรมจากวิดีโอนี้ไม่ได้')), options);
    signal.addEventListener('abort', () => finish(signal.reason), options);
    try { update(); } catch (error) { finish(error); }
  });
}

export function buildVideoFrameTimes(durationSeconds: number, intervalSeconds = VIDEO_FRAME_INTERVAL_SECONDS): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error('Video frame interval must be positive.');

  const times: number[] = [];
  for (let time = 0; time < durationSeconds; time += intervalSeconds) times.push(time);
  if (times.length > MAX_VIDEO_FRAMES) throw new Error('Video is too long. Maximum supported duration is 60 minutes.');
  return times;
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<File> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('The video is not ready for analysis yet.');
  }

  const frameTime = video.currentTime;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to decode the current video frame.');

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode the current video frame.')), 'image/jpeg', FRAME_JPEG_QUALITY);
  });
  return new File([blob], `frame-${frameTime.toFixed(1)}s.jpg`, { type: 'image/jpeg' });
}
