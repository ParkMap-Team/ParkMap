import { useState } from 'react';
import type { ParkingAnalysisResponse } from '@/types/parkingAnalysis';
import type { DetectionResponse } from '@/types/detection';

type Props = { imageUrl: string | null; analysis: ParkingAnalysisResponse | null | undefined; detection?: DetectionResponse | null };
export function CameraParkingOverlay({ imageUrl, analysis, detection }: Props) {
  const [selected, setSelected] = useState<{ rowId: string; index: number } | null>(null);
  const rows = analysis?.capacity?.rows ?? [];
  const states = new Map((analysis?.parking_state?.rows ?? []).map((row) => [row.row_id, row]));
  const placements = rows.flatMap((row) => {
    const state = states.get(row.row_id);
    const safetyRow = analysis?.witness_safety?.rows.find((item) => item.row_id === row.row_id);
    if (state?.validation !== true || row.validation?.valid !== true || !safetyRow || !row.capacity || !row.placements) return [];
    return row.placements.flatMap((placement, index) => { if (safetyRow.witnesses[index]?.uncertainty_status !== 'CLEAR') return []; const image = (placement as { footprint_image_normalized?: { polygons?: { x: number; y: number }[][][] } }).footprint_image_normalized; const polygon = image?.polygons?.[0]?.[0]; if (!polygon?.length) return []; return [{ row, index, polygon }]; });
  });
  const roi = analysis?.physical_map?.parking_roi_image_normalized?.polygons?.[0]?.[0] as unknown as Array<{ x: number; y: number }> | undefined;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Camera View</h2><span className="text-sm text-emerald-700">Green = Safe parking</span></div><div className="mt-3 overflow-hidden rounded-xl bg-slate-950">{imageUrl ? <div className="relative"><img src={imageUrl} alt="Analyzed camera" className="block h-auto w-full" /><svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">{roi && <polygon points={roi.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#38bdf8" strokeWidth=".003" strokeDasharray=".01 .006" />}{placements.map(({ row, index, polygon }) => { const key = `${row.row_id}:${index}`; const active = selected?.rowId === row.row_id && selected.index === index; return <polygon key={key} points={polygon.map((point) => `${point.x},${point.y}`).join(' ')} onClick={() => setSelected({ rowId: row.row_id, index })} className="cursor-pointer" fill="rgba(34,197,94,.3)" stroke={active ? '#fef08a' : '#4ade80'} strokeWidth={active ? '.006' : '.003'} />; })}{detection?.detections.map((item, index) => <rect key={`detection-${index}`} x={item.bbox.x} y={item.bbox.y} width={item.bbox.width} height={item.bbox.height} fill="rgba(239,68,68,.08)" stroke="#ef4444" strokeWidth=".003" />)}</svg></div> : <div className="grid min-h-64 place-items-center text-sm text-slate-400">Analyze an image to view camera parking positions.</div>}</div><div className="mt-2 text-xs text-slate-500">Blue outline = Parking ROI · Red boxes = YOLO detections · Green = API parking positions</div>{selected && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">Possible parking position — {selected.rowId.replace('row_', 'R')} · Additional capacity: {states.get(selected.rowId)?.capacity ?? 'Unavailable'} · Production footprint: 0.66 × 2.00m · Geometry source: Backend capacity witness</p>}</section>;
}




