"use client";

import { AlertCircle, ImagePlus, LoaderCircle, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraMonitor } from '@/components/camera/CameraMonitor';
import { PhysicalMeasuredMap } from '@/components/parking/PhysicalMeasuredMap';
import { ParkingStateSummary } from '@/components/parking/ParkingStateSummary';
import { CameraParkingOverlay } from '@/components/parking/CameraParkingOverlay';
import { adaptBackendParkingGeometry } from '@/lib/legacyParkingAnalysis';
import { getCalibration } from '@/lib/calibration';
import { analyzeParkingImage, MAX_UPLOAD_BYTES, SUPPORTED_IMAGE_TYPES } from '@/lib/detection';
import { getGroundPlaneHomography } from '@/lib/groundPlaneHomography';
import { buildMetricMotorcycleMapping } from '@/lib/metricMotorcycle';
import { getPhysicalRowGeometry } from '@/lib/physicalRowGeometry';
import { assignDetectionsToParkingRows } from '@/lib/rowAssignment';
import type { ParkingCalibration } from '@/types/calibration';
import type { DetectionResponse } from '@/types/detection';
import type { GroundPlaneHomographyResponse } from '@/types/groundPlaneCalibration';
import type { PhysicalRowGeometryResponse } from '@/types/physicalRowGeometry';

export function ImageAnalyzer({ onOpenSetup }: { onOpenSetup: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DetectionResponse | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parkingView, setParkingView] = useState<'camera' | 'physical'>('physical');
  const [calibration, setCalibration] = useState<ParkingCalibration | null>(null);
  const [homography, setHomography] = useState<GroundPlaneHomographyResponse | null>(null);
  const [physical, setPhysical] = useState<PhysicalRowGeometryResponse | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    void getCalibration(controller.signal)
      .then((savedCalibration) => {
        setCalibration(savedCalibration);
        if (!savedCalibration) {
          setSetupRequired(true);
          return null;
        }
        return Promise.all([getGroundPlaneHomography(controller.signal), getPhysicalRowGeometry(controller.signal)])
          .then(([savedHomography, savedPhysical]) => {
            setHomography(savedHomography);
            setPhysical(savedPhysical);
            setSetupRequired(false);
          });
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setSetupRequired(true);
      });
    return () => controller.abort();
  }, [file]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined, [previewUrl]);

  const assignments = useMemo(() => analysis && calibration ? assignDetectionsToParkingRows(analysis.detections, calibration) : [], [analysis, calibration]);
  const mapping = useMemo(() => analysis ? buildMetricMotorcycleMapping(analysis.detections, assignments, homography, physical, analysis.image_width, analysis.image_height) : null, [analysis, assignments, homography, physical]);
  const legacyParkingGeometry = useMemo(() => analysis?.parking_analysis ? adaptBackendParkingGeometry(analysis.parking_analysis) : null, [analysis]);
  const occupiedSpace = legacyParkingGeometry?.occupiedSpace ?? null;
  const freeSpace = legacyParkingGeometry?.freeSpace ?? null;
  const mapReady = physical?.status === 'CURRENT' && physical.rows.every((row) => row.status === 'PHYSICAL_READY') && homography?.current === true && homography.status === 'VALIDATED';

  const chooseFile = (selected?: File) => {
    controllerRef.current?.abort();
    setAnalysis(null);
    setState('idle');
    setError(null);
    if (!selected) return;
    if (!SUPPORTED_IMAGE_TYPES.includes(selected.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
      setFile(null); setPreviewUrl(null); setError('Choose a JPEG, PNG, or WebP image.'); return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null); setPreviewUrl(null); setError('Image must be 25 MB or smaller.'); return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const analyze = async () => {
    if (!file) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('processing');
    setError(null);
    try {
      const result = await analyzeParkingImage(file, controller.signal, !setupRequired);
      setAnalysis(result);
      setState('done');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to analyze this image.');
      setState('error');
    }
  };

  const motorcycles = analysis?.detections.length ?? 0;
  const validMetric = mapping?.motorcycles.filter((item) => item.transform_valid).length ?? 0;
  const backendSummary = analysis?.parking_analysis?.detection_summary;
  const insideRoi = backendSummary?.parking_included ?? 0;
  const excluded = backendSummary?.parking_excluded ?? 0;
  const analysisUnavailable = state === 'done' && !analysis?.parking_analysis;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="camera-image-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 id="camera-image-title" className="text-lg font-semibold">Camera / Image</h1><p className="mt-1 text-sm text-slate-500">JPEG, PNG or WebP · up to 25 MB</p></div>
          <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ImagePlus className="size-4" />{file ? 'Choose another' : 'Choose image'}<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
            <button type="button" onClick={() => void analyze()} disabled={!file || state === 'processing'} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{state === 'processing' ? <LoaderCircle className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}{state === 'processing' ? 'Analyzing…' : 'Analyze'}</button>
          </div>
        </div>
        {file && <p className="mt-3 truncate text-sm text-slate-500">{file.name}</p>}
        {setupRequired && <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />กรุณาตั้งค่าพื้นที่จอดในหน้า Setup ก่อน แล้วจึงกลับมาวิเคราะห์รูป</span><button type="button" onClick={onOpenSetup} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white">ไปที่ Setup</button></div>}
        {error && !setupRequired && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />{error}</span>{file && state === 'error' && <button type="button" onClick={() => void analyze()} className="inline-flex items-center gap-1 font-semibold"><RotateCcw className="size-4" />Retry</button>}</div>}
      </section>

      <CameraMonitor imageUrl={previewUrl} analysis={analysis} assignments={assignments} />
      <div className="flex gap-2 text-sm"><button type="button" onClick={() => setParkingView('camera')} className={parkingView === 'camera' ? 'font-semibold text-blue-700' : 'text-slate-500'}>Camera View</button><button type="button" onClick={() => setParkingView('physical')} className={parkingView === 'physical' ? 'font-semibold text-blue-700' : 'text-slate-500'}>Physical Map</button></div>
      {parkingView === 'camera' ? <CameraParkingOverlay imageUrl={previewUrl} analysis={analysis?.parking_analysis} /> : <PhysicalMeasuredMap physical={physical} mapping={mapping} homography={homography} occupiedSpace={occupiedSpace} freeSpace={freeSpace} fitting={null} recommendations={analysis?.parking_analysis?.placement_recommendation} capacity={analysis?.parking_analysis?.capacity} almostAvailablePlacements={analysis?.parking_analysis?.almost_available_placements} witnessSafety={analysis?.parking_analysis?.witness_safety} parkingState={analysis?.parking_analysis?.parking_state} uncertainty={analysis?.parking_analysis?.uncertainty} />}
      {analysis?.parking_analysis && <ParkingStateSummary analysis={analysis.parking_analysis} />}

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" aria-labelledby="summary-title">
        <h2 id="summary-title" className="font-semibold">Summary</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Detected motorcycles</dt><dd className="mt-1 text-2xl font-bold">{motorcycles}</dd></div>
          <div><dt className="text-slate-500">Parking Analysis Included</dt><dd className="mt-1 text-2xl font-bold">{insideRoi}</dd></div>
          <div><dt className="text-slate-500">Parking Analysis Excluded</dt><dd className="mt-1 text-2xl font-bold">{excluded}</dd></div>
          <div><dt className="text-slate-500">System status</dt><dd className={`mt-1 text-lg font-bold ${mapReady ? 'text-emerald-700' : 'text-amber-700'}`}>{mapReady ? 'Map ready' : 'Calibration required'}</dd></div>
        </dl>
        {analysisUnavailable && <p role="status" className="mt-3 text-sm text-amber-700">วิเคราะห์ YOLO ได้แล้ว แต่ยังหาที่จอดให้ไม่ได้ กรุณาไปตั้งค่าในหน้า Setup ก่อน</p>}
        {!mapReady && <button type="button" onClick={onOpenSetup} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Open Setup</button>}
        {analysis && mapReady && validMetric !== motorcycles && <p className="mt-3 text-sm text-amber-700">Some detections could not be placed on the parking map.</p>}
      </section>
    </div>
  );
}
