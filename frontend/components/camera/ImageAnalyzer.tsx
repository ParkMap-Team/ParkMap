'use client';

import { AlertCircle, ImagePlus, LoaderCircle, MapPinned, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ParkingCalibration } from '@/components/calibration/ParkingCalibration';
import { CameraMonitor } from '@/components/camera/CameraMonitor';
import { analyzeParkingImage, MAX_UPLOAD_BYTES, SUPPORTED_IMAGE_TYPES } from '@/lib/detection';
import type { DetectionResponse } from '@/types/detection';
import type { CameraData, CameraOverlay, ModelData, ParkingZone, SystemState } from '@/types/parking';

export function ImageAnalyzer({ camera, model, zone, status, fallbackOverlays = [] }: { camera?: CameraData; model?: ModelData; zone: ParkingZone; status: SystemState; fallbackOverlays?: CameraOverlay[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [analysis, setAnalysis] = useState<DetectionResponse | null>(null);
  const [analysisState, setAnalysisState] = useState<'idle' | 'processing' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (!previewUrl) return; return () => URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const chooseFile = (selected?: File) => {
    controllerRef.current?.abort();
    setAnalysis(null);
    setAnalysisState('idle');
    setError(null);
    if (!selected) return;
    if (!SUPPORTED_IMAGE_TYPES.includes(selected.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) { setFile(null); setPreviewUrl(null); setDimensions(null); setError('Choose a JPEG, PNG, or WebP image.'); return; }
    if (selected.size > MAX_UPLOAD_BYTES) { setFile(null); setPreviewUrl(null); setDimensions(null); setError('Image must be 25 MB or smaller.'); return; }
    const objectUrl = URL.createObjectURL(selected);
    setFile(selected);
    setPreviewUrl(objectUrl);
    const probe = new Image();
    probe.onload = () => setDimensions({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => setError('The selected image could not be previewed.');
    probe.src = objectUrl;
  };

  const analyze = async () => {
    if (!file) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setAnalysisState('processing');
    setError(null);
    try {
      const result = await analyzeParkingImage(file, controller.signal);
      setAnalysis(result);
      setDimensions({ width: result.image_width, height: result.image_height });
      setAnalysisState('done');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Unable to analyze this image.');
      setAnalysisState('error');
    }
  };

  const detectionOverlays: CameraOverlay[] = analysis?.detections.map((detection, index) => ({
    id: `detection-${index}`,
    type: 'bounding-box',
    x: detection.bbox.x,
    y: detection.bbox.y,
    width: detection.bbox.width,
    height: detection.bbox.height,
    label: `${detection.class_name} ${(detection.confidence * 100).toFixed(0)}%`,
  })) ?? [];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Analyze parking image</h3>
            <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP · up to 25 MB · YOLO motorcycle detection</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <ImagePlus className="size-4" />{file ? 'Choose another' : 'Choose image'}
              <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => void analyze()} disabled={!file || analysisState === 'processing'} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {analysisState === 'processing' ? <LoaderCircle className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}{analysisState === 'processing' ? 'Analyzing…' : 'Analyze'}
            </button>
            <button type="button" onClick={() => setCalibrationOpen(true)} disabled={!file || !previewUrl || !dimensions} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
              <MapPinned className="size-4" />Calibrate parking area
            </button>
          </div>
        </div>
        {file && <p className="mt-3 truncate text-xs text-slate-500">Selected: <span className="font-medium text-slate-700">{file.name}</span></p>}
        {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4 shrink-0" />{error}</span>{file && <button type="button" onClick={() => void analyze()} className="inline-flex shrink-0 items-center gap-1 font-semibold"><RotateCcw className="size-3.5" />Retry</button>}</div>}
      </div>
      <CameraMonitor camera={camera} model={model} zone={zone} status={analysisState === 'processing' ? 'processing' : status} imageUrl={previewUrl} imageDimensions={dimensions} analysis={analysis} overlays={previewUrl ? detectionOverlays : fallbackOverlays} />
      {calibrationOpen && previewUrl && dimensions && <ParkingCalibration open onOpenChange={setCalibrationOpen} imageUrl={previewUrl} imageWidth={dimensions.width} imageHeight={dimensions.height} cameraId={camera?.id ?? 'SPU_CAM_01'} detections={analysis?.detections ?? []} />}
    </div>
  );
}
