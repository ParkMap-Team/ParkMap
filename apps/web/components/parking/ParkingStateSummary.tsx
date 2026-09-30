import type { ParkingAnalysisResponse, ParkingState } from '@/types/parkingAnalysis';

const stateMeaning: Record<ParkingState, string> = {
  AVAILABLE: 'จอดเพิ่มได้',
  ADJUSTABLE: 'จัดรถใหม่ก่อน',
  UNAVAILABLE: 'ไม่มีพื้นที่จอดเพิ่ม',
  UNCERTAIN: 'ข้อมูลยังไม่แน่นอน',
};

export function ParkingStateSummary({ analysis }: { analysis?: ParkingAnalysisResponse }) {
  if (!analysis?.parking_state?.rows || !analysis.capacity?.rows) return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">ไม่สามารถประเมินสถานะการจอดได้</section>;
  const stateRows = analysis.parking_state.rows;
  const capacities = new Map(analysis.capacity.rows.map((row) => [row.row_id, row.capacity]));
  const recommendations = new Map((analysis.placement_recommendation?.rows ?? []).map((row) => [row.row_id, row]));
  const plans = new Map((analysis.rearrangement_plan?.plans ?? []).map((row) => [row.row_id, row]));
  const counts = stateRows.reduce<Record<ParkingState, number>>((result, row) => { result[row.state] = (result[row.state] ?? 0) + 1; return result; }, { AVAILABLE: 0, ADJUSTABLE: 0, UNAVAILABLE: 0, UNCERTAIN: 0 });
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="parking-status-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="parking-status-title" className="font-semibold">Parking status</h2><p className="mt-1 text-sm text-slate-500">Backend-authoritative row status and current additional capacity</p></div><div className="flex flex-wrap gap-2 text-xs text-slate-600">{(['AVAILABLE', 'ADJUSTABLE', 'UNCERTAIN', 'UNAVAILABLE'] as ParkingState[]).map((state) => <span key={state} className="rounded-full bg-slate-100 px-2 py-1">{state}: {counts[state]}</span>)}</div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{stateRows.map((row) => { const recommendation = recommendations.get(row.row_id); const plan = plans.get(row.row_id); const label = row.validation ? stateMeaning[row.state] : 'สถานะไม่พร้อมใช้งาน'; const recommendationLabel = recommendation?.status === 'PARK_HERE' && recommendation.validation ? 'PARK HERE' : String(recommendation?.status) === 'REARRANGE_FIRST' && recommendation?.validation ? 'จัดรถใหม่ก่อน' : 'ไม่แนะนำ'; return <article key={row.row_id} className="rounded-xl border border-slate-200 p-3"><div className="font-semibold">{row.row_id.replace('row_', 'R')}</div><div className={`mt-1 text-sm font-bold ${row.state === 'AVAILABLE' ? 'text-emerald-700' : row.state === 'UNCERTAIN' ? 'text-amber-700' : row.state === 'ADJUSTABLE' ? 'text-blue-700' : 'text-rose-700'}`}>{row.state}</div><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-sm">Capacity: <strong>{capacities.get(row.row_id) ?? '—'}</strong></div><div className="mt-1 text-xs font-semibold text-slate-600">{recommendationLabel}</div>{row.state === 'UNCERTAIN' && <div className="mt-1 text-xs text-amber-700">{row.evidence_ids.length} detections need review</div>}{plan?.status === 'READY' && <div className="mt-2 text-xs text-blue-700">สามารถจัดรถใหม่เพื่อเพิ่มพื้นที่จอดได้</div>}</article>; })}</div>
  </section>;
}


