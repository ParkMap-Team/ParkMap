"use client";

import { AlertCircle, ImagePlus, LoaderCircle, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraMonitor } from '@/components/camera/CameraMonitor';
import { PhysicalMeasuredMap } from '@/components/parking/PhysicalMeasuredMap';
import { ExperimentalSizeDiagnostic } from '@/components/parking/ExperimentalSizeDiagnostic';
import { RowAssignmentV2Diagnostic } from '@/components/parking/RowAssignmentV2Diagnostic';
import { DetectionMapDiagnostic } from '@/components/camera/DetectionMapDiagnostic';
import { RoiRowsGeometryDiagnostic } from '@/components/parking/RoiRowsGeometryDiagnostic';
import { calculateOccupiedSpaceV1 } from '@/lib/occupiedSpace';
import { OccupiedSpaceDiagnostic } from '@/components/parking/OccupiedSpaceDiagnostic';
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
  const [calibration, setCalibration] = useState<ParkingCalibration | null>(null);
  const [homography, setHomography] = useState<GroundPlaneHomographyResponse | null>(null);
  const [physical, setPhysical] = useState<PhysicalRowGeometryResponse | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getCalibration(controller.signal), getGroundPlaneHomography(controller.signal), getPhysicalRowGeometry(controller.signal)])
      .then(([savedCalibration, savedHomography, savedPhysical]) => {
        setCalibration(savedCalibration);
        setHomography(savedHomography);
        setPhysical(savedPhysical);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Map calibration could not be loaded.');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined, [previewUrl]);

  const assignments = useMemo(() => analysis && calibration ? assignDetectionsToParkingRows(analysis.detections, calibration) : [], [analysis, calibration]);
  const mapping = useMemo(() => analysis ? buildMetricMotorcycleMapping(analysis.detections, assignments, homography, physical, analysis.image_width, analysis.image_height) : null, [analysis, assignments, homography, physical]);
  const occupiedSpace = useMemo(() => mapping && physical ? calculateOccupiedSpaceV1(mapping.motorcycles, physical) : null, [mapping, physical]);
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
      setAnalysis(await analyzeParkingImage(file, controller.signal));
      setState('done');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Unable to analyze this image.');
      setState('error');
    }
  };

  const motorcycles = analysis?.detections.length ?? 0;
  const validMetric = mapping?.motorcycles.filter((item) => item.transform_valid).length ?? 0;
  const insideRoi = mapping?.motorcycles.filter((item) => item.inside_parking_roi).length ?? 0;
  const assigned = mapping?.motorcycles.filter((item) => item.inside_parking_roi && (item.row_assignment_v2.state === 'POINT_ASSIGNED' || item.row_assignment_v2.state === 'FOOTPRINT_ASSIGNED')).length ?? 0;
  const insideWithoutRow = insideRoi - assigned;
  const excluded = motorcycles - insideRoi;
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
        {error && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="inline-flex items-center gap-2"><AlertCircle className="size-4" />{error}</span>{file && state === 'error' && <button type="button" onClick={() => void analyze()} className="inline-flex items-center gap-1 font-semibold"><RotateCcw className="size-4" />Retry</button>}</div>}
      </section>

      <CameraMonitor imageUrl={previewUrl} analysis={analysis} assignments={assignments} />
      <DetectionMapDiagnostic analysis={analysis} assignments={assignments} mapping={mapping} />
      <RoiRowsGeometryDiagnostic physical={physical} homography={homography} />
      <PhysicalMeasuredMap physical={physical} mapping={mapping} homography={homography} />
      <ExperimentalSizeDiagnostic mapping={mapping} />
      <RowAssignmentV2Diagnostic mapping={mapping} />
      <OccupiedSpaceDiagnostic result={occupiedSpace} />

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" aria-labelledby="summary-title">
        <h2 id="summary-title" className="font-semibold">Summary</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Detected motorcycles</dt><dd className="mt-1 text-2xl font-bold">{motorcycles}</dd></div>
          <div><dt className="text-slate-500">Parking Analysis Included</dt><dd className="mt-1 text-2xl font-bold">{insideRoi}</dd></div>
          <div><dt className="text-slate-500">Parking Analysis Excluded</dt><dd className="mt-1 text-2xl font-bold">{excluded}</dd></div>
          <div><dt className="text-slate-500">System status</dt><dd className={`mt-1 text-lg font-bold ${mapReady ? 'text-emerald-700' : 'text-amber-700'}`}>{mapReady ? 'Map ready' : 'Calibration required'}</dd></div>
        </dl>
        {analysis && <p className="mt-3 text-sm text-slate-600">Metric projected: <strong>{validMetric}</strong> · Parking analysis included: <strong>{insideRoi}</strong> · Parking analysis excluded: <strong>{excluded}</strong> · Physical map rendered: <strong>{insideRoi}</strong> · Row Assignment V2 assigned: <strong>{assigned}</strong> · Without row: <strong>{insideWithoutRow}</strong></p>}
        {!mapReady && <button type="button" onClick={onOpenSetup} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Open Setup</button>}
        {analysis && mapReady && validMetric !== motorcycles && <p className="mt-3 text-sm text-amber-700">Some detections could not be placed on the parking map.</p>}
      </section>
    </div>
  );
}
