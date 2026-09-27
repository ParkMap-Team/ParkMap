import { Route } from 'lucide-react';
import type { RowOccupancyProjectionData } from '@/types/calibration';

export function RowOccupancyProjection({ projection }: { projection: RowOccupancyProjectionData }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><Route className="size-5 text-cyan-600" /><h2 className="font-semibold">Row Occupancy Projection</h2></div>
      <p className="mt-2 text-xs text-slate-500">Debug view: Normalized row position (0–1) for each assigned motorcycle. This is not capacity or availability.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {projection.rows.map((row) => <div key={row.row_id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{row.name}</h3><span className="text-xs text-slate-500">{row.motorcycles.length} motorcycles</span></div>
          {!row.centerline.ok ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">Unsupported row geometry: {row.centerline.error}</p> : <>
            <div className="relative mx-3 mt-7 h-8" aria-label={`${row.name} normalized positions`}>
              <div className="absolute inset-x-0 top-3 h-0.5 bg-slate-300" />
              <span className="absolute -left-3 top-5 text-[10px] text-slate-400">0.0</span><span className="absolute -right-3 top-5 text-[10px] text-slate-400">1.0</span>
              {row.motorcycles.map((motorcycle) => <span key={motorcycle.detection_index} title={`Detection #${motorcycle.detection_index}: t=${motorcycle.row_position.t.toFixed(3)}`} className="absolute top-1 size-5 -translate-x-1/2 rounded-full border-2 border-white bg-cyan-500 text-center text-[9px] font-bold leading-4 text-slate-950 shadow" style={{ left: `${motorcycle.row_position.t * 100}%` }}>{motorcycle.detection_index}</span>)}
            </div>
            {row.motorcycles.length ? <ul className="mt-3 flex flex-wrap gap-2">{row.motorcycles.map((motorcycle) => <li key={motorcycle.detection_index} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">#{motorcycle.detection_index} t={motorcycle.row_position.t.toFixed(3)}</li>)}</ul> : <p className="mt-3 text-xs text-slate-400">No assigned motorcycles</p>}
          </>}
        </div>)}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 text-xs text-slate-600">
        <span className="rounded-md bg-amber-50 px-2 py-1">Unassigned: {projection.unassigned.length}</span>
        <span className="rounded-md bg-purple-50 px-2 py-1">Ambiguous: {projection.ambiguous.length}</span>
        <span className="rounded-md bg-slate-100 px-2 py-1">Outside ROI: {projection.outside_roi.length}</span>
        {projection.unsupported.length > 0 && <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">Unsupported: {projection.unsupported.length}</span>}
      </div>
    </section>
  );
}
