"use client";

import { AlertCircle, ImagePlus, LoaderCircle, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CameraMonitor } from '@/components/camera/CameraMonitor';
import { SegmentationExperiment } from '@/components/parking/SegmentationExperiment';
import { getCalibration } from '@/lib/calibration';
import { analyzeParkingSegmentation, detectMotorcycleFrame, MAX_UPLOAD_BYTES, SUPPORTED_IMAGE_TYPES } from '@/lib/detection';
import { BYTES_PER_MIB, CLEARANCE_MARGIN_STEP_M, DEFAULT_CLEARANCE_MARGIN_M, DEFAULT_IMAGE_DETECTOR, DEFAULT_VIDEO_DETECTOR, DETECTOR_OPTIONS, MAX_CLEARANCE_MARGIN_M, MAX_LOCAL_VIDEO_MIB, MAX_UPLOAD_MIB, type ParkingDetector } from '@/lib/parkingSettings';
import type { components } from '@/types/api.gen';
import type { DetectionResponse } from '@/types/detection';

export function ImageAnalyzer({ onOpenSetup }: { onOpenSetup: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [selectedDetector, setSelectedDetector] = useState<ParkingDetector | null>(null);
  const [clearanceMargin, setClearanceMargin] = useState(String(DEFAULT_CLEARANCE_MARGIN_M));
  const clearanceMarginValue = Number(clearanceMargin);
  const clearanceMarginValid = clearanceMargin !== '' && Number.isFinite(clearanceMarginValue) && clearanceMarginValue >= 0 && clearanceMarginValue <= MAX_CLEARANCE_MARGIN_M;
  const [segmentationGaps, setSegmentationGaps] = useState<components['schemas']['SegmentationGapResult'] | null>(null);
  const [segmentation, setSegmentation] = useState<components['schemas']['SegmentationExperimentResult'] | null>(null);
  const [segmentationError, setSegmentationError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const detector = selectedDetector ?? (videoUrl ? DEFAULT_VIDEO_DETECTOR : DEFAULT_IMAGE_DETECTOR);
  const usesSegmentation = detector === 'yolo26n-seg';
  const [analysis, setAnalysis] = useState<DetectionResponse | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!file || videoUrl || !usesSegmentation) return;
    const controller = new AbortController();
    void getCalibration(controller.signal)
      .then((savedCalibration) => {
        setSetupRequired(!savedCalibration);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setSetupRequired(true);
      });
    return () => controller.abort();
  }, [file, videoUrl, usesSegmentation]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined, [previewUrl]);
  useEffect(() => videoUrl ? () => URL.revokeObjectURL(videoUrl) : undefined, [videoUrl]);

  function resetAnalysis() {
    controllerRef.current?.abort();
    setAnalysis(null);
    setSegmentation(null); setSegmentationGaps(null); setSegmentationError('');

    setState('idle');
    setError(null);
    setSetupRequired(false);
  }

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    resetAnalysis();
    const isVideo = selected.type.startsWith('video/');
    if (!isVideo && !SUPPORTED_IMAGE_TYPES.includes(selected.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError('Choose a JPEG, PNG, WebP, MP4, or WebM file.'); return;
    }
    if (!isVideo && selected.size > MAX_UPLOAD_BYTES) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError(`Image must be ${MAX_UPLOAD_MIB} MB or smaller.`); return;
    }
    if (isVideo && selected.size > MAX_LOCAL_VIDEO_MIB * BYTES_PER_MIB) {
      setFile(null); setPreviewUrl(null); setVideoUrl(null); setError(`Video must be ${MAX_LOCAL_VIDEO_MIB} MB or smaller.`); return;
    }
    setFile(selected);
    setPreviewUrl(isVideo ? null : URL.createObjectURL(selected));
    setVideoUrl(isVideo ? URL.createObjectURL(selected) : null);
  };

  const analyze = async () => {
    if (!file || videoUrl || (usesSegmentation && !clearanceMarginValid)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('processing');
    setSegmentation(null); setSegmentationGaps(null); setSegmentationError('');

    setAnalysis(null);
    setError(null);
    try {
      if (usesSegmentation) {
        const result = await analyzeParkingSegmentation(file, controller.signal, !setupRequired, undefined, clearanceMarginValue, detector);
        if (controller.signal.aborted) return;
        setAnalysis(result.detection as DetectionResponse);
        setSegmentation(result.segmentation ?? null); setSegmentationGaps(result.segmentation_gaps ?? null); setSegmentationError(result.segmentation_error ?? '');
        setError(result.parking_error ?? null);
      } else {
        const result = await detectMotorcycleFrame(file, detector, controller.signal);
        if (controller.signal.aborted) return;
        setAnalysis(result as DetectionResponse);
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
          <div><h1 id="camera-image-title" className="text-lg font-semibold">Camera / Image / Video</h1><p className="mt-1 text-sm text-slate-500">JPEG, PNG, WebP, MP4 or WebM</p></div>
          <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ImagePlus className="size-4" />{file ? 'Choose another' : 'Choose file'}<input type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,image/jpeg,image/png,image/webp,video/*" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
            {!videoUrl && <button type="button" onClick={() => void analyze()} disabled={!file || (usesSegmentation && !clearanceMarginValid) || state === 'processing'} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{state === 'processing' ? <LoaderCircle className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}{state === 'processing' ? 'Analyzing…' : 'Analyze'}</button>}
          </div>
        </div>
        {file && <p className="mt-3 truncate text-sm text-slate-500">{file.name}</p>}
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm font-medium">
          โมเดลตรวจจับ
          <select value={detector} className="rounded-lg border border-slate-300 bg-white px-3 py-2" onChange={event => {
            setSelectedDetector(event.target.value as ParkingDetector);
            resetAnalysis();
          }}>
            {DETECTOR_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {!videoUrl && usesSegmentation && <div className="mt-4 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
          <label className="flex flex-wrap items-center gap-2">ระยะเผื่อด้านข้างรวมสองข้าง (ม.)
            <input type="number" aria-label="ระยะเผื่อด้านข้างรวม" min="0" max={MAX_CLEARANCE_MARGIN_M} step={CLEARANCE_MARGIN_STEP_M} value={clearanceMargin} className="w-32 rounded border bg-white p-2" onChange={event => {
              controllerRef.current?.abort(); setState('idle'); setSegmentationGaps(null); setClearanceMargin(event.target.value);
            }} />
          </label>
          <p className="text-xs text-slate-600">การเทียบช่องว่างใช้ความกว้างอ้างอิงของระบบบวกระยะเผื่อรวม</p>
          {!clearanceMarginValid && <p role="alert" className="text-red-700">ระยะเผื่อรวมต้องอยู่ระหว่าง 0–{MAX_CLEARANCE_MARGIN_M} ม.</p>}
        </div>}
        {setupRequired && <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />กรุณาตั้งค่าพื้นที่จอดในหน้า Setup ก่อน แล้วจึงกลับมาวิเคราะห์รูป</span><button type="button" onClick={onOpenSetup} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white">ไปที่ Setup</button></div>}
        {error && !setupRequired && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />{error}</span>{file && state === 'error' && <button type="button" onClick={() => void analyze()} className="inline-flex items-center gap-1 font-semibold"><RotateCcw className="size-4" />Retry</button>}</div>}
      </section>

      <div className="space-y-4">
        <CameraMonitor imageUrl={previewUrl} videoUrl={videoUrl} analysis={analysis} segmentation={segmentation} detector={detector} />
        {!videoUrl && usesSegmentation && <SegmentationExperiment primary result={segmentation} error={segmentationError} gaps={segmentationGaps} />}
      </div>
    </div>
  );
}
