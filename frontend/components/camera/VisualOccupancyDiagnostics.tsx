import { ScanSearch } from 'lucide-react';
import type { VisualOccupancyDiagnosticsData } from '@/types/occupancyDiagnostics';

export function VisualOccupancyDiagnostics({ data }: { data: VisualOccupancyDiagnosticsData }) {
  const relevant = data.detections.filter((item) => item.primary_assignment.status !== 'OUTSIDE_ROI' || item.bbox_intersects_parking_roi);
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2"><ScanSearch className="size-5 text-violet-600" /><h2 className="font-semibold">Visual Occupancy Diagnostics</h2></div>
    <p className="mt-2 text-xs leading-5 text-slate-500">Visual overlap is based on YOLO bounding boxes in normalized image space. It is a detection-footprint proxy, not a physical ground-area measurement.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-5"><Metric label="Inside ROI by primary assignment" value={data.primary_inside_roi} /><Metric label="Unassigned" value={data.unassigned} /><Metric label="Unassigned with row overlap" value={data.unassigned_with_visual_row_overlap} /><Metric label="Unassigned without row overlap" value={data.unassigned_without_visual_row_overlap} /><Metric label="Overlapping multiple rows" value={data.visually_overlapping_multiple_rows} /></div>
    <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2 xl:grid-cols-3">
      {relevant.map((item) => <article key={item.detection_index} className={`rounded-xl border p-3 ${item.primary_assignment.status === 'UNASSIGNED' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between gap-2"><strong className="text-sm">#{item.detection_index}</strong><span className="text-xs font-semibold text-slate-600">Primary: {item.primary_assignment.row_id ? item.primary_assignment.row_id.replace('_', ' ').toUpperCase() : item.primary_assignment.status}</span></div>
        {item.geometry_error ? <p className="mt-2 text-xs text-red-700">Geometry error: {item.geometry_error}</p> : item.intersecting_rows.length ? <ul className="mt-2 space-y-1 text-xs text-slate-600">{item.intersecting_rows.map((row) => <li key={row.row_id} className="flex justify-between gap-2"><span>{row.row_id.replace('_', ' ').toUpperCase()}</span><span className="font-mono">{(row.bbox_overlap_ratio * 100).toFixed(1)}% bbox overlap</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-400">No visual row overlap</p>}
        {item.primary_assignment.status === 'OUTSIDE_ROI' && item.bbox_intersects_parking_roi && <p className="mt-2 text-xs text-violet-700">Bottom-center remains outside; bbox partially intersects ROI ({(item.parking_roi_bbox_overlap_ratio * 100).toFixed(1)}%).</p>}
      </article>)}
      {!relevant.length && <p className="text-sm text-slate-400">No detections relevant to the Parking ROI.</p>}
    </div>
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
