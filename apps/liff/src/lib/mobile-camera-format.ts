export function matchesCameraAspect(width: number, height: number, referenceWidth: number, referenceHeight: number) {
  return width > 0 && height > 0 && Math.abs((width / height) / (referenceWidth / referenceHeight) - 1) <= .007;
}

export async function openMatchingCamera(devices: Pick<MediaDevices, 'getUserMedia'>, width: number, height: number) {
  const video = { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height } };
  try {
    return await devices.getUserMedia({ audio: false, video: { ...video, aspectRatio: { exact: width / height } } });
  } catch (error) {
    // Some mobile browsers reject exact constraints. Validate actual video dimensions before upload.
    if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error;
    return devices.getUserMedia({ audio: false, video: { ...video, aspectRatio: { ideal: width / height } } });
  }
}
