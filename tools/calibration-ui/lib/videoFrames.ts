export const VIDEO_FRAME_INTERVAL_SECONDS = 5;
export const MAX_VIDEO_FRAMES = 360;

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

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to decode the current video frame.');

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode the current video frame.')), 'image/jpeg', 0.92);
  });
  return new File([blob], `frame-${video.currentTime.toFixed(1)}s.jpg`, { type: 'image/jpeg' });
}
