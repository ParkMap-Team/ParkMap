import { Rows3 } from 'lucide-react';
import type { OccupiedGap, OccupiedInterval, OccupiedIntervalPrototypeData } from '@/types/occupiedIntervals';

const normalizedRange = (start: number, end: number) => `t ${start.toFixed(3)}–${end.toFixed(3)}`;
const metricRange = (item: Pick<OccupiedInterval | OccupiedGap, 'position_start_m' | 'position_end_m' | 'metric_source'>) => item.position_start_m === null || item.position_end_m === null
  ? 'metric: not calibrated'
  : `${item.position_start_m.toFixed(2)}–${item.position_end_m.toFixed(2)} m · ${item.metric_source}`;

export function OccupiedIntervalsAndGaps({ data }: { data: OccupiedIntervalPrototypeData }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start gap-2"><Rows3 className="mt-0.5 size-5 text-indigo-600" /><div><h2 className="font-semibold">Occupied Intervals &amp; Gaps</h2><p className="mt-1 text-xs leading-5 text-slate-500">Prototype derived from the fixed bottom 20% Ground Proxy. Gaps are geometric complements only; they are not labelled available, free, or parkable.</p></div></div>
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {data.rows.map((row) => <article key={row.row_id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.name}</strong><span className="text-xs text-slate-500">{row.contributing_detection_count} detections · {row.obstruction_count} obstructions · {row.merged_intervals.length} merged · {row.gaps.length} gaps</span></div>
        <IntervalList title="Individual / obstruction intervals" empty="No occupied interval" items={row.intervals.map((item) => ({ key: `${item.detection_index}-${item.row_id}-${item.source_type}`, label: `#${item.detection_index} · ${item.source_type}`, range: normalizedRange(item.t_start, item.t_end), metric: metricRange(item) }))} />
        <IntervalList title="Merged occupied intervals" empty="No merged occupied interval" items={row.merged_intervals.map((item, index) => ({ key: `merged-${index}`, label: `detections ${item.detection_indices.map((value) => `#${value}`).join(', ')} · ${item.source_types.join(' + ')}`, range: normalizedRange(item.t_start, item.t_end), metric: metricRange(item) }))} />
        <IntervalList title="Gaps (geometric complement)" empty="No remaining gap" items={row.gaps.map((item, index) => ({ key: `gap-${index}`, label: `normalized length ${item.normalized_length.toFixed(3)}`, range: normalizedRange(item.t_start, item.t_end), metric: item.gap_length_m === null ? metricRange(item) : `${metricRange(item)} · length ${item.gap_length_m.toFixed(2)} m` }))} />
      </article>)}
    </div>
    {data.unsupported.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{data.unsupported.length} interval(s) could not be derived because required intersection or row geometry was unavailable.</p>}
  </section>;
}

function IntervalList({ title, empty, items }: { title: string; empty: string; items: Array<{ key: string; label: string; range: string; metric: string }> }) {
  return <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>{items.length ? <ul className="mt-1 space-y-1.5">{items.map((item) => <li key={item.key} className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs"><div className="flex flex-wrap justify-between gap-1"><span className="font-semibold text-slate-700">{item.label}</span><span className="font-mono text-slate-600">{item.range}</span></div><p className="mt-1 text-slate-500">{item.metric}</p></li>)}</ul> : <p className="mt-1 text-xs text-slate-400">{empty}</p>}</div>;
}
