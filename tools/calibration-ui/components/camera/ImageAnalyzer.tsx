"use client";

import { AlertCircle, ImagePlus, LoaderCircle, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CameraMonitor } from '@/components/camera/CameraMonitor';
import { SegmentationExperiment } from '@/components/parking/SegmentationExperiment';
import { getCalibration } from '@/lib/calibration';
import { analyzeParkingSegmentation, MAX_UPLOAD_BYTES, SUPPORTED_IMAGE_TYPES } from '@/lib/detection';
import type { components } from '@/types/api.gen';
import { captureVideoFrame, VIDEO_FRAME_INTERVAL_SECONDS } from '@/lib/videoFrames';
import type { DetectionResponse } from '@/types/detection';

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export function ImageAnalyzer({ onOpenSetup }: { onOpenSetup: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [incomingWidth, setIncomingWidth] = useState('');
  const [clearanceMargin, setClearanceMargin] = useState('0');
  const clearanceMarginValue = Number(clearanceMargin);
  const incomingWidthValue = incomingWidth === '' ? undefined : Number(incomingWidth);
  const incomingWidthValid = (incomingWidthValue === undefined || (Number.isFinite(incomingWidthValue) && incomingWidthValue > 0 && incomingWidthValue <= 5)) && clearanceMargin !== '' && Number.isFinite(clearanceMarginValue) && clearanceMarginValue >= 0 && clearanceMarginValue <= 1;
  const [segmentationGaps, setSegmentationGaps] = useState<components['schemas']['SegmentationGapResult'] | null>(null);
  const [segmentation, setSegmentation] = useState<components['schemas']['SegmentationExperimentResult'] | null>(null);
  const [segmentationError, setSegmentationError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoAnalysisActive, setVideoAnalysisActive] = useState(false);
  const [analysis, setAnalysis] = useState<DetectionResponse | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [videoProgress, setVideoProgress] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoAnalysisBusyRef = useRef(false);

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    void getCalibration(controller.signal)
      .then((savedCalibration) => {
        setSetupRequired(!savedCalibration);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setSetupRequired(true);
      });
    return () => controller.abort();
  }, [file]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined, [previewUrl]);
  useEffect(() => videoUrl ? () => URL.revokeObjectURL(videoUrl) : undefined, [videoUrl]);

  useEffect(() => {
    if (!videoAnalysisActive || !videoUrl) return;
    const controller = new AbortController();
    controllerRef.current = controller;

    const analyzeCurrentFrame = async () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || videoAnalysisBusyRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      videoAnalysisBusyRef.current = true;
      setState('processing');
      setAnalysis(null);
      setError(null);

      try {
        const frameTime = video.currentTime;
        const frame = await captureVideoFrame(video);        setSegmentation(null); setSegmentationGaps(null); setSegmentationError('');
        const result = await analyzeParkingSegmentation(frame, controller.signal, !setupRequired, incomingWidthValue, clearanceMarginValue);
        if (controller.signal.aborted) return;
        setAnalysis(result.detection as DetectionResponse);

        setSegmentation(result.segmentation ?? null); setSegmentationGaps(result.segmentation_gaps ?? null); setSegmentationError(result.segmentation_error ?? '');

        setState('done');
        setError(result.parking_error ?? null);
        setVideoProgress(`Latest analysis: ${frameTime.toFixed(1)}s · refreshes every ${VIDEO_FRAME_INTERVAL_SECONDS} seconds`);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'Unable to analyze this video frame.');
          setState('error');
        }
      } finally {
        videoAnalysisBusyRef.current = false;
      }
    };

    const start = () => void analyzeCurrentFrame();
    const video = videoRef.current;
    video?.addEventListener('playing', start);
    if (video && !video.paused) start();
    const timer = window.setInterval(start, VIDEO_FRAME_INTERVAL_SECONDS * 1000);
    return () => {
      window.clearInterval(timer);
      video?.removeEventListener('playing', start);
      controller.abort();
      videoAnalysisBusyRef.current = false;
    };
  }, [setupRequired, videoAnalysisActive, videoUrl, incomingWidthValue, clearanceMarginValue]);

  const chooseFile = (selected?: File) => {
    controllerRef.current?.abort();
    setAnalysis(null);
    setSegmentation(null); setSegmentationGaps(null); setSegmentationError('');

    setState('idle');
    setError(null);
    setVideoProgress(null);
    setVideoAnalysisActive(false);    if (!selected) return;
    const isVideo = selected.type.startsWith('video/');
    if (!isVideo && !SUPPORTED_IMAGE_TYPES.includes(selected.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError('Choose a JPEG, PNG, WebP, MP4, or WebM file.'); return;
    }
    if (!isVideo && selected.size > MAX_UPLOAD_BYTES) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError('Image must be 25 MB or smaller.'); return;
    }
    if (isVideo && selected.size > MAX_VIDEO_BYTES) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError('Video must be 500 MB or smaller.'); return;
    }
    setFile(selected);
    setPreviewUrl(isVideo ? null : URL.createObjectURL(selected));
    setVideoUrl(isVideo ? URL.createObjectURL(selected) : null);
  };

  const analyze = async () => {
    if (!file || !incomingWidthValid) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('processing');
    setSegmentation(null); setSegmentationGaps(null); setSegmentationError('');

    setAnalysis(null);
    setError(null);
    try {
      if (file.type.startsWith('video/')) {
        setVideoAnalysisActive(true);
        setVideoProgress(`Live playback · analysis starts now and refreshes every ${VIDEO_FRAME_INTERVAL_SECONDS} seconds`);
        await videoRef.current?.play();
        return;
      } else {
        const result = await analyzeParkingSegmentation(file, controller.signal, !setupRequired, incomingWidthValue, clearanceMarginValue);
        if (controller.signal.aborted) return;
        setAnalysis(result.detection as DetectionResponse);

        setSegmentation(result.segmentation ?? null); setSegmentationGaps(result.segmentation_gaps ?? null); setSegmentationError(result.segmentation_error ?? '');

        setError(result.parking_error ?? null);
      }
      setState('done');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to analyze this image.');
      setState('error');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="camera-image-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 id="camera-image-title" className="text-lg font-semibold">Camera / Image / Video</h1><p className="mt-1 text-sm text-slate-500">JPEG, PNG, WebP, MP4 or WebM · video analyzed every 5 seconds</p></div>
          <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ImagePlus className="size-4" />{file ? 'Choose another' : 'Choose file'}<input type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,image/jpeg,image/png,image/webp,video/*" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
            <button type="button" onClick={() => void analyze()} disabled={!file || !incomingWidthValid || state === 'processing' || videoAnalysisActive} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{state === 'processing' ? <LoaderCircle className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}{state === 'processing' ? 'Analyzing…' : 'Analyze'}</button>
          </div>
        </div>
        {file && <p className="mt-3 truncate text-sm text-slate-500">{file.name}</p>}
        <p className="mt-3 text-sm font-medium text-cyan-900">{segmentation?.model ?? 'Segmentation · ชื่อโมเดลจะแสดงหลังวิเคราะห์'}</p>
        <div className="mt-4 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
          <label className="flex flex-wrap items-center gap-2">ความกว้างรถที่จะเข้าจอด (ม.)
            <input type="number" aria-label="ความกว้างรถที่จะเข้าจอด" min="0.001" max="5" step="0.001" value={incomingWidth} placeholder="เช่น 0.75 หรือ 1.20" className="w-44 rounded border bg-white p-2" onChange={event => {
              controllerRef.current?.abort(); setVideoAnalysisActive(false); setVideoProgress(null); setState('idle'); setSegmentationGaps(null);
              setIncomingWidth(event.target.value);
            }} />
          </label>
          <label className="flex flex-wrap items-center gap-2">ระยะเผื่อด้านข้างรวมสองข้าง (ม.)
            <input type="number" aria-label="ระยะเผื่อด้านข้างรวม" min="0" max="1" step="0.01" value={clearanceMargin} className="w-32 rounded border bg-white p-2" onChange={event => {
              controllerRef.current?.abort(); setVideoAnalysisActive(false); setVideoProgress(null); setState('idle'); setSegmentationGaps(null); setClearanceMargin(event.target.value);
            }} />
          </label>
          <p className="text-xs text-slate-600">แสดงทุกช่วงว่างเต็มความกว้าง เทียบกับความกว้างรถ + ระยะเผื่อรวม ไม่บังคับขั้นต่ำ 1 ม. · ไม่กรอกขนาดรถใช้ค่าอ้างอิง 0.66 ม. · ระยะเผื่อเริ่มต้น 0 ม. ไม่ใช่ระยะปลอดภัยที่ผ่านการรับรอง · ยังไม่ตรวจความยาวรถหรือทางเข้า–ออก</p>
          {!incomingWidthValid && <p role="alert" className="text-red-700">ความกว้างต้องมากกว่า 0 และไม่เกิน 5 ม. ระยะเผื่อรวมต้องอยู่ระหว่าง 0–1 ม.</p>}
        </div>
        {videoProgress && <p role="status" className="mt-2 text-sm text-blue-700">{videoProgress}</p>}
        {setupRequired && <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />กรุณาตั้งค่าพื้นที่จอดในหน้า Setup ก่อน แล้วจึงกลับมาวิเคราะห์รูป</span><button type="button" onClick={onOpenSetup} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white">ไปที่ Setup</button></div>}
        {error && !setupRequired && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />{error}</span>{file && state === 'error' && <button type="button" onClick={() => void analyze()} className="inline-flex items-center gap-1 font-semibold"><RotateCcw className="size-4" />Retry</button>}</div>}
      </section>

      <div className="space-y-4">
        <CameraMonitor imageUrl={previewUrl} videoUrl={videoUrl} videoRef={videoRef} analysis={analysis} segmentation={segmentation} />
        <SegmentationExperiment primary result={segmentation} error={segmentationError} gaps={segmentationGaps} />
      </div>
    </div>
  );
}
