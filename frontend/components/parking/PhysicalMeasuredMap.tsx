'use client';
import { useEffect, useState } from 'react';
import { getPhysicalRowGeometry } from '@/lib/physicalRowGeometry';
import type { PhysicalRowGeometryResponse } from '@/types/physicalRowGeometry';

export function PhysicalMeasuredMap() {
  const [data, setData] = useState<PhysicalRowGeometryResponse | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); void getPhysicalRowGeometry(controller.signal).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load physical row geometry.')); return () => controller.abort(); }, []);
  if (error) return <div className="grid min-h-[420px] place-items-center bg-slate-950 p-6 text-center text-amber-300">{error}</div>;
  if (!data) return <div className="grid min-h-[420px] place-items-center bg-slate-950 text-slate-400">Loading physical row geometry…</div>;
  const rows = data.rows.filter((row) => row.physical_polygon);
  if (!rows.length) return <div className="grid min-h-[420px] place-items-center bg-slate-950 p-6 text-center"><div><p className="font-semibold text-slate-200">Physical row geometry is not ready.</p><p className="mt-2 text-sm text-slate-400">Validated map calibration and measured row dimensions are required.</p></div></div>;
  const points = rows.flatMap((row) => row.physical_polygon!); const minX = Math.min(...points.map((p) => p.x_m)), maxX = Math.max(...points.map((p) => p.x_m)), minY = Math.min(...points.map((p) => p.y_m)), maxY = Math.max(...points.map((p) => p.y_m)); const range = Math.max(maxX - minX, maxY - minY, .001), scale = Math.min(880 / range, 520 / range); const map = (point: { x_m: number; y_m: number }) => `${60 + (point.x_m - minX) * scale},${585 - (point.y_m - minY) * scale}`;
  return <div className="bg-slate-950 p-5"><svg viewBox="0 0 1000 650" className="w-full rounded-xl" aria-label="Physical measured row geometry"><rect width="1000" height="650" rx="20" fill="#172033" />{rows.map((row) => <g key={row.row_id}><polygon points={row.physical_polygon!.map(map).join(' ')} fill="rgba(167,139,250,.2)" stroke="#a78bfa" strokeWidth="3" /><text x={Number(map(row.physical_polygon![0]).split(',')[0])} y={Number(map(row.physical_polygon![0]).split(',')[1]) - 10} fill="white" fontSize="15" fontWeight="700">{row.row_id.replace('row_', 'R')} · {row.measured_length_m} m × {row.measured_width_m} m · {row.provenance}</text></g>)}</svg><p className="mt-3 text-xs text-slate-400">Physical measured rows use existing calibrated row geometry by default. A row uses manual endpoints only when its override is explicitly enabled.</p></div>;
}
