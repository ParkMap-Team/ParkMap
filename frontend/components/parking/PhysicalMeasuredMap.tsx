import type { MetricMotorcycleMapping } from '@/types/metricMotorcycle';
import type { PhysicalRowGeometryResponse } from '@/types/physicalRowGeometry';
import type { GroundPlaneHomographyResponse, GroundPlaneMetricPoint } from '@/types/groundPlaneCalibration';
import { parkingMapMotorcycles, parkingMapRoi } from '@/lib/metricMotorcycle';

export function PhysicalMeasuredMap({ physical, mapping, homography }: { physical: PhysicalRowGeometryResponse | null; mapping: MetricMotorcycleMapping | null; homography: GroundPlaneHomographyResponse | null }) {
  const rows = physical?.rows.filter((r) => r.status === 'PHYSICAL_READY' && r.physical_polygon) ?? [];
  if (!rows.length) return <section className="grid min-h-80 place-items-center rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900"><div><h2 className="font-semibold">Parking map needs calibration</h2><p className="mt-1 text-sm">Parking rows, measured dimensions, and validated map calibration are required.</p></div></section>;
  const motorcycles = parkingMapMotorcycles(mapping), footprints = motorcycles.filter((m) => m.footprint_polygon), roi = parkingMapRoi(homography);
  const points = [...rows.flatMap((r) => r.physical_polygon!), ...roi, ...motorcycles.map((m) => m.metric_point!), ...footprints.flatMap((m) => m.footprint_polygon!)];
  const xs = points.map((p) => p.x_m), ys = points.map((p) => p.y_m), padding = 1.5, minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), width = Math.max(maxX - minX + padding * 2, 1), height = Math.max(maxY - minY + padding * 2, 1);
  const polygon = (items: GroundPlaneMetricPoint[]) => items.map((p) => `${p.x_m},${-p.y_m}`).join(' ');
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="parking-map-title"><div className="border-b border-slate-200 px-5 py-4"><h2 id="parking-map-title" className="font-semibold">Parking map</h2><p className="mt-1 text-sm text-slate-500">Physical R1–R5 and mapped motorcycle positions</p></div><div className="bg-slate-950 p-4 sm:p-6"><svg viewBox={`${minX - padding} ${-(maxY + padding)} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block max-h-[560px] w-full" style={{ aspectRatio: `${width} / ${height}` }} aria-label="Physical measured parking map">
    {roi.length >= 3 && <polygon points={polygon(roi)} fill="rgba(148,163,184,.04)" stroke="#94a3b8" strokeWidth=".06" strokeDasharray=".25 .18" vectorEffect="non-scaling-stroke" />}
    {rows.map((r) => <polygon key={r.row_id} points={polygon(r.physical_polygon!)} fill="rgba(59,130,246,.18)" stroke="#60a5fa" strokeWidth=".08" vectorEffect="non-scaling-stroke" />)}
    {footprints.map((m) => <polygon key={`${m.detection_id}-footprint`} points={polygon(m.footprint_polygon!)} fill="rgba(251,191,36,.28)" stroke="#fbbf24" strokeWidth=".06" vectorEffect="non-scaling-stroke" />)}
    {motorcycles.map((m) => <g key={m.detection_id}><circle cx={m.metric_point!.x_m} cy={-m.metric_point!.y_m} r=".18" fill={m.physical_containment === 'INSIDE_PHYSICAL_ROW' ? '#22c55e' : '#f59e0b'} stroke="#fff" strokeWidth=".06" /><text x={m.metric_point!.x_m + .25} y={-m.metric_point!.y_m + .16} fill="white" fontSize=".42" fontWeight="700">{m.detection_index + 1}</text></g>)}
  </svg></div></section>;
}
