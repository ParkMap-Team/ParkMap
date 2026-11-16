import { Camera } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { captureVideoFrame } from '@/lib/videoFrames';

export function VideoFramePreview({ videoUrl, videoRef }: {
  videoUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ url: string; time: number; width: number; height: number } | null>(null);
  const pendingCapture = useRef<AbortController | null>(null);

  useEffect(() => () => pendingCapture.current?.abort(), []);
  const frameUrl = frame?.url;
  useEffect(() => () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  async function capture() {
    const video = videoRef.current;
    if (!video || video.seeking) return;

    const request = new AbortController();
    pendingCapture.current?.abort();
    pendingCapture.current = request;
    setCapturing(true);
    setError(null);
    video.pause();
    const { currentTime: time, videoWidth: width, videoHeight: height } = video;

    try {
      const image = await captureVideoFrame(video);
      if (!request.signal.aborted) setFrame({ url: URL.createObjectURL(image), time, width, height });
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to capture this frame.');
    } finally {
      if (!request.signal.aborted) setCapturing(false);
    }
  }

  return (
    <>
      <div className="bg-slate-950">
        <video ref={videoRef} src={videoUrl} aria-label="Parking camera video"
          className="mx-auto block max-h-[620px] max-w-full" preload="auto" controls muted loop playsInline
          onLoadedData={() => setReady(true)} onSeeking={() => setReady(false)} onSeeked={() => setReady(true)}
          onError={() => {
            setReady(false);
            setError('Unable to play this video. Try an MP4 or WebM supported by your browser.');
          }} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-3">
        <button type="button" disabled={!ready || capturing} onClick={() => void capture()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          <Camera className="size-4" aria-hidden="true" />
          {capturing ? 'Capturing…' : 'Capture Frame'}
        </button>
        <p className="text-sm text-slate-600">เลื่อนไปยังเวลาที่ต้องการ แล้วจับภาพจากวิดีโอ</p>
      </div>
      {error && <p role="alert" className="px-5 pb-3 text-sm text-red-700">{error}</p>}
      {frame && (
        <figure className="border-t border-slate-200">
          <figcaption role="status" className="px-5 py-3 text-sm font-medium text-slate-700">
            Captured frame · {frame.time.toFixed(1)} s · {frame.width} × {frame.height} px
          </figcaption>
          <div className="grid place-items-center bg-slate-950">
            <img src={frame.url} alt="Captured video frame" className="block max-h-[620px] max-w-full object-contain" />
          </div>
        </figure>
      )}
    </>
  );
}
