"use client";
import { useEffect, useState } from "react";

type Point = { x: number; y: number };
type Segment = { segment_id: string; start: Point; end: Point; anchor_ids: number[]; support_status: string };
type Row = { row_id: string; display_id?: string; centerline?: Point[]; supported_segments?: Segment[] | null };
type Detection = { detection_id?: string; x?: number; y?: number; point?: Point; bbox?: { x: number; y: number; width: number; height: number }; inside_roi?: boolean };
type State = { source_type: string; status: string; updated_at?: string | null; rows: Row[]; detections?: Detection[]; available_regions?: Point[][]; unknown_anchors: unknown[]; summary: Record<string, number>; roi?: { polygon: Point[] } | null };
type Mode = "AUTO" | "HYBRID";

export function DashboardClient() {
  const [mode, setMode] = useState<Mode>("AUTO");
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setState(null);
    setError(false);
    const endpoint = mode === "AUTO" ? "/api/auto-parking/state" : "/api/hybrid-parking/state";
    fetch(`http://localhost:8000${endpoint}`).then((response) => {
      if (!response.ok) throw Error();
      return response.json();
    }).then((value: State) => { if (active) setState(value); }).catch(() => active && setError(true));
    return () => { active = false; };
  }, [mode]);

  const displayedRoi = state?.roi?.polygon ?? [];

  return <main className="min-h-screen bg-slate-950 text-slate-100"><section className="mx-auto max-w-screen-2xl px-5 py-6">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-300">ParkMap</p><h1 className="text-2xl font-semibold">Motorcycle Parking</h1><p className="mt-1 text-sm text-slate-400">เลือกโหมดการวิเคราะห์ แล้วดูผลบนแผนที่เดียวกัน</p></div><div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1"><button type="button" onClick={() => setMode("AUTO")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "AUTO" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>AUTO</button><button type="button" onClick={() => setMode("HYBRID")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "HYBRID" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>HYBRID</button></div></header>
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">{mode === "AUTO" ? "ระบบให้ backend หา ROI แถว รถ และพื้นที่ว่าง แล้วหน้านี้แสดงผลอย่างเดียว" : "โหมด Hybrid รับ ROI รถ แถว และพื้นที่ว่างจาก backend แล้วแสดงบนแผนที่เดียวกัน"}</div>
    {!state && !error && <p className="text-slate-400">Loading parking status…</p>}{error && <p className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-200">Parking status is temporarily unavailable.</p>}
    {state && <><div className="mb-4 flex flex-wrap gap-3 text-sm text-slate-300"><span>Mode: {mode}</span><span>System: {state.status}</span><span>Source: {state.source_type}</span>{state.updated_at && <span>Updated: {state.updated_at}</span>}</div>
      <div className="relative min-h-[70vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-6"><div className="absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(#334155 1px,transparent 1px),linear-gradient(90deg,#334155 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
        <svg viewBox="0 0 1 1" className="relative min-h-[60vh] w-full">{state.available_regions?.map((region, index) => <polygon key={index} points={region.map((point) => `${point.x},${point.y}`).join(" ")} fill="#22c55e" fillOpacity=".18" stroke="#86efac" strokeWidth=".002" />)}{state.rows.map((row) => { const p = row.centerline ?? []; return <g key={row.row_id}>{p.length >= 2 && <line x1={p[0].x} y1={p[0].y} x2={p[1].x} y2={p[1].y} stroke="#64748b" strokeWidth=".003" strokeDasharray=".012 .008" />}{(row.supported_segments ?? []).map((segment) => <line key={segment.segment_id} x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} stroke="#22d3ee" strokeWidth=".012" strokeLinecap="round" />)}{p.length > 0 && <text x={p[0].x} y={p[0].y - .015} fill="white" fontSize=".025">{row.display_id ?? row.row_id}</text>}</g>; })}{state.detections?.filter((detection) => detection.inside_roi === true).map((detection, index) => { const point = detection.point ?? (detection.x !== undefined && detection.y !== undefined ? { x: detection.x, y: detection.y } : null); return point ? <circle key={detection.detection_id ?? index} cx={point.x} cy={point.y} r=".01" fill="#f97316" stroke="#fff7ed" strokeWidth=".003" /> : null; })}{displayedRoi.length > 1 && <polygon points={displayedRoi.map((point) => `${point.x},${point.y}`).join(" ")} fill="#22d3ee" fillOpacity=".12" stroke="#facc15" strokeWidth=".004" strokeDasharray=".012 .008" />}</svg>
      </div><div className="mt-4 grid gap-3 sm:grid-cols-4">{Object.entries(state.summary).map(([key, value]) => <div key={key} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><p className="text-xs text-slate-500">{key}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div><p className="mt-5 text-xs text-slate-500">Unknown evidence remains unassigned. Availability and corridor capacity are not estimated.</p></>}
  </section></main>;
}
