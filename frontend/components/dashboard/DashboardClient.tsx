'use client';

import { AlertTriangle, Maximize2, RefreshCw, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParkingHistoryChart } from '@/components/analytics/ParkingHistoryChart';
import { MetricCalibration } from '@/components/calibration/MetricCalibration';
import { ParkMapBrand } from '@/components/dashboard/ParkMapBrand';
import { ImageAnalyzer } from '@/components/camera/ImageAnalyzer';
import { DataSourceSwitcher } from '@/components/dashboard/DataSourceSwitcher';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { ParkingMap } from '@/components/parking/ParkingMap';
import { ParkingStats } from '@/components/parking/ParkingStats';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { mockParkingHistory } from '@/lib/mockParkingHistory';
import { getParkingStatus, isParkingDataStale, PARKING_POLL_INTERVAL_MS, PARKMAP_API_URL, summarizeParkingObjects } from '@/lib/parking';
import type { CameraOverlay, DataSourceMode, DemoScenario, ParkingMapData, SystemState } from '@/types/parking';

const overlayDemo: CameraOverlay[] = [{ id: 'roi', type: 'roi', points: [{ x: .08, y: .15 }, { x: .92, y: .11 }, { x: .95, y: .88 }, { x: .12, y: .9 }] }, { id: 'box-1', type: 'bounding-box', x: .2, y: .3, width: .09, height: .28 }];

export function DashboardClient({ initialData }: { initialData: ParkingMapData }) {
  const [mode, setMode] = useState<DataSourceMode>('demo');
  const [scenario, setScenario] = useState<DemoScenario>('normal');
  const [data, setData] = useState(initialData);
  const [requestState, setRequestState] = useState<SystemState>('online');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);

  const changeMode = (next: DataSourceMode) => { localStorage.setItem('parkmap-data-source', next); setMode(next); setRequestState('loading'); setErrorMessage(null); };
  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await getParkingStatus({ mode, scenario, signal });
      setData(result);
      setErrorMessage(null);
      setRequestState(result.systemStatus ?? (isParkingDataStale(result.timestamp) ? 'stale' : 'online'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load parking data.');
      setRequestState('stale');
    }
  }, [mode, scenario]);

  useEffect(() => {
    let controller: AbortController | null = new AbortController();
    const initialTimer = window.setTimeout(() => void loadData(controller?.signal), 0);
    if (mode !== 'live') return () => { window.clearTimeout(initialTimer); controller?.abort(); };
    const timer = window.setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      void loadData(controller.signal);
    }, PARKING_POLL_INTERVAL_MS);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); controller?.abort(); };
  }, [loadData, mode, retryKey]);

  const summary = data.summary ?? summarizeParkingObjects(data.objects);
  const state: SystemState = errorMessage ? (data ? 'stale' : requestState) : data.systemStatus === 'processing' ? 'processing' : isParkingDataStale(data.timestamp) ? 'stale' : requestState;
  const staleOrError = state === 'stale' || state === 'offline' || state === 'error';
  const camera = data.camera ?? { id: data.cameraId ?? 'Unknown', name: 'SPU Motorcycle Parking', status: state, lastFrameAt: data.timestamp };

  const mapSubtitle = useMemo(() => `${data.zone.name} · normalized coordinates 0.00–1.00`, [data.zone.name]);

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10"><ParkMapBrand /><div className="flex flex-col items-start gap-3 lg:items-end"><SystemStatus timestamp={data.timestamp} status={state} mode={mode} /><DataSourceSwitcher mode={mode} scenario={scenario} onModeChange={changeMode} onScenarioChange={setScenario} /></div></div></header>
    <div className="mx-auto max-w-[1500px] space-y-6 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
      {errorMessage && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2 text-red-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><strong>{errorMessage}</strong><p className="mt-0.5 text-red-700">Last successful data remains visible and is marked stale.</p></div></div><button type="button" onClick={() => setRetryKey((key) => key + 1)} className="inline-flex w-fit items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white"><RefreshCw className="size-3.5" />Retry</button></div>}
      <section aria-label="Parking summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"><SummaryCard label="Motorcycles detected" value={summary.motorcycles} icon="motorcycle" tone="blue" /><SummaryCard label="Available areas" value={summary.available} icon="available" tone="green" /><SummaryCard label="Occupied" value={summary.occupied} icon="occupied" tone="red" /><SummaryCard label="Uncertain" value={summary.uncertain} icon="uncertain" tone="amber" /></section>
      {mode === 'demo' && <p className="-mt-3 text-xs font-medium text-violet-600">Summary values are simulated for demonstration and do not represent a calibrated parking capacity.</p>}
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]"><div ref={mapRef} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${staleOrError ? 'border-amber-300' : 'border-slate-200'}`}><div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><div className="flex items-center gap-2"><ScanLine className="size-5 text-blue-600" /><h2 className="font-semibold">2D parking map</h2><StatusBadge status={state} /></div><p className="mt-1 text-sm text-slate-500">{mapSubtitle}</p></div><button type="button" onClick={() => void mapRef.current?.requestFullscreen()} className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Maximize2 className="size-4" />Fullscreen map</button></div><ParkingMap data={data} /></div><div className="space-y-6"><ImageAnalyzer camera={{ ...camera, status: state === 'processing' ? camera.status : state }} model={data.model} zone={data.zone} fallbackOverlays={mode === 'demo' ? overlayDemo : []} status={state} /><ParkingStats data={data} /></div></section>
      <MetricCalibration cameraId={camera.id} />
      <ParkingHistoryChart data={mockParkingHistory} />
      <details className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm"><summary className="cursor-pointer font-semibold text-slate-700">Development details</summary><dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4"><DebugItem label="Data source" value={mode.toUpperCase()} /><DebugItem label="Camera / zone" value={`${data.cameraId ?? '—'} / ${data.zone.id}`} /><DebugItem label="API URL" value={PARKMAP_API_URL} /><DebugItem label="Polling" value={`${PARKING_POLL_INTERVAL_MS / 1000} seconds`} /><DebugItem label="Timestamp" value={data.timestamp} /><DebugItem label="Objects" value={String(data.objects.length)} /></dl></details>
    </div>
  </main>;
}

function DebugItem({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 truncate font-mono text-xs font-semibold text-slate-700" title={value}>{value}</dd></div>; }
