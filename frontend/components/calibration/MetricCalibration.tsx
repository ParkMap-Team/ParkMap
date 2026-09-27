'use client';

import { AlertCircle, CheckCircle2, LoaderCircle, Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getMetricCalibration, saveMetricCalibration } from '@/lib/metricCalibration';
import type { MetricCalibrationResponse, MetricRowId } from '@/types/metricCalibration';

const ROW_IDS: MetricRowId[] = ['row_1', 'row_2', 'row_3', 'row_4', 'row_5'];
const EMPTY_LENGTHS: Record<MetricRowId, string> = { row_1: '', row_2: '', row_3: '', row_4: '', row_5: '' };

export function MetricCalibration({ cameraId = 'SPU_CAM_01' }: { cameraId?: string }) {
  const [response, setResponse] = useState<MetricCalibrationResponse | null>(null);
  const [lengths, setLengths] = useState({ ...EMPTY_LENGTHS });
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getMetricCalibration(controller.signal).then((result) => {
      setResponse(result);
      const restored = { ...EMPTY_LENGTHS };
      for (const row of result.calibration?.rows ?? []) restored[row.id] = String(row.length_m);
      setLengths(restored);
      setState('ready');
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'Unable to load metric calibration.');
      setState('error');
    });
    return () => controller.abort();
  }, []);

  const parsedRows = ROW_IDS.flatMap((id) => {
    const value = lengths[id].trim();
    return value ? [{ id, length_m: Number(value) }] : [];
  });
  const invalid = parsedRows.some((row) => !Number.isFinite(row.length_m) || row.length_m <= 0);

  const save = async () => {
    if (invalid) return;
    setState('saving'); setMessage(null);
    try {
      const result = await saveMetricCalibration({
        schema_version: 1, camera_id: response?.calibration?.camera_id ?? cameraId, unit: 'meter', rows: parsedRows,
        reference_segments: response?.calibration?.reference_segments ?? [],
        ground_control_points: response?.calibration?.ground_control_points ?? [],
      });
      setResponse(result); setState('ready'); setMessage('Physical measurements saved.');
    } catch (error) {
      setState('error'); setMessage(error instanceof Error ? error.message : 'Unable to save metric calibration.');
    }
  };

  const status = response?.status ?? 'NOT_CALIBRATED';
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Ruler className="size-5 text-blue-600" /><h2 className="font-semibold">Metric Calibration</h2></div><p className="mt-1 text-sm text-slate-500">Physical measurements are optional until site measurements are available.</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${status === 'CALIBRATED' ? 'bg-emerald-100 text-emerald-800' : status === 'PARTIALLY_CALIBRATED' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{status.replaceAll('_', ' ')}</span></div>
    {status === 'NOT_CALIBRATED' && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Physical measurements required.</strong><p className="mt-1">Real-world measurements have not been entered yet. Normalized image geometry remains available for debugging.</p></div>}
    <div className="mt-5"><h3 className="text-sm font-semibold">Parking Row Measurements</h3><p className="mt-1 text-xs text-slate-500">Enter measured usable row lengths in meters. Blank rows remain unmeasured.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{ROW_IDS.map((id, index) => <label key={id} className="text-xs font-medium text-slate-600">Row {index + 1} length<div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white focus-within:border-blue-500"><input type="number" min="0" step="any" inputMode="decimal" value={lengths[id]} onChange={(event) => setLengths((current) => ({ ...current, [id]: event.target.value }))} placeholder="Not measured" className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-sm outline-none" /><span className="pr-3 text-slate-400">m</span></div></label>)}</div></div>
    {invalid && <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-red-700"><AlertCircle className="size-4" />Every entered length must be a finite number greater than zero.</p>}
    <div className="mt-5 rounded-xl bg-slate-50 p-4"><h3 className="text-sm font-semibold">Parking ROI references & ground-control points</h3><p className="mt-1 text-xs leading-5 text-slate-500">Prepared for future measured reference segments and image-to-ground point correspondences. No points or homography are generated automatically; accurate 2D ground-plane calibration will require sufficient surveyed references.</p></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Image calibration: configured separately · Ground-plane calibration: unavailable</p><button type="button" onClick={() => void save()} disabled={state === 'loading' || state === 'saving' || invalid} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{state === 'saving' ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{state === 'saving' ? 'Saving…' : 'Save measurements'}</button></div>
    {message && <p role={state === 'error' ? 'alert' : 'status'} className={`mt-3 text-xs ${state === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message}</p>}
  </section>;
}
