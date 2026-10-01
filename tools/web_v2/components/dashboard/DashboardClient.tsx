"use client";

import { useEffect, useState } from "react";

type Point = { x: number; y: number };
type ParkingState = {
  status: string;
  updated_at?: string | null;
  rows: any[];
  detections?: any[];
  roi?: { polygon: Point[] } | null;
  image?: { url: string; width: number; height: number } | null;
};

const formatTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "medium",
        hour12: false,
        timeZone: "Asia/Bangkok",
      }).format(new Date(value))
    : "ไม่มีข้อมูลเวลา";

export function DashboardClient() {
  const [mode, setMode] = useState<"AUTO" | "HYBRID">("HYBRID");
  const [view, setView] = useState<"2D" | "3D">("2D");
  const [state, setState] = useState<ParkingState | null>(null);

  useEffect(() => {
    let active = true;
    const endpoint = mode === "AUTO" ? "auto-parking" : "hybrid-parking";
    const load = () =>
      fetch(`http://localhost:8000/api/${endpoint}/state`)
        .then((response) => response.json())
        .then((value) => active && setState(value as ParkingState));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mode]);

  const buttonClass = (active: boolean) =>
    `rounded px-3 py-2 text-sm ${active ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`;
  const imageUrl = state?.image?.url
    ? `http://localhost:8000${state.image.url}?state=${encodeURIComponent(state.updated_at ?? "latest")}`
    : null;

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <header className="mx-auto flex max-w-6xl justify-between">
        <h1 className="text-2xl">Motorcycle Parking</h1>
        <div className="flex gap-1">
          <button className={buttonClass(mode === "AUTO")} onClick={() => setMode("AUTO")}>AUTO</button>
          <button className={buttonClass(mode === "HYBRID")} onClick={() => setMode("HYBRID")}>HYBRID</button>
          <span className="mx-2 border-l border-slate-700" />
          <button className={buttonClass(view === "2D")} onClick={() => setView("2D")}>2D</button>
          <button className={buttonClass(view === "3D")} onClick={() => setView("3D")}>3D</button>
        </div>
      </header>

      {state && (
        <section className="mx-auto mt-4 max-w-6xl">
          <p>โหมด: {mode} · มุมมอง: {view} · สถานะ: {state.status} · อัปเดต: {formatTime(state.updated_at)}</p>
          <div
            className="relative mt-4 overflow-hidden rounded-xl bg-slate-900"
            style={{ aspectRatio: state.image ? `${state.image.width}/${state.image.height}` : "4/3" }}
          >
            {view === "3D" && imageUrl && <img src={imageUrl} className="absolute inset-0 size-full object-fill" />}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full">
              {state.roi?.polygon && (
                <polygon points={state.roi.polygon.map((point) => `${point.x},${point.y}`).join(" ")} fill="#f0abfc" fillOpacity=".1" stroke="#e879f9" strokeWidth=".005" />
              )}
              {state.rows.map((row: any, index: number) => {
                const geometry = row.polygon ?? row.row?.polygon ?? row.centerline ?? row.row?.centerline ?? [];
                if (geometry.length < 2) return null;
                const rowId = row.row_id ?? row.row?.row_id ?? `row_${index + 1}`;
                return <polygon key={rowId} points={geometry.map((point: Point) => `${point.x},${point.y}`).join(" ")} fill="#14532d" fillOpacity=".55" stroke="#34d399" strokeWidth=".005" />;
              })}
              {state.detections?.map((detection: any, index: number) => detection.bbox && (
                <rect key={detection.detection_id ?? index} x={detection.bbox.x} y={detection.bbox.y} width={detection.bbox.width} height={detection.bbox.height} fill="#ef4444" fillOpacity=".3" stroke="#f87171" strokeWidth=".002" />
              ))}
            </svg>
          </div>
        </section>
      )}
    </main>
  );
}
