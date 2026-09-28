import type { MetricMotorcycleMapping } from '@/types/metricMotorcycle';
import type { PhysicalRowGeometryResponse } from '@/types/physicalRowGeometry';
import type { GroundPlaneHomographyResponse } from '@/types/groundPlaneCalibration';
import { parkingMapMotorcycles, parkingMapRoi } from '@/lib/metricMotorcycle';

export function PhysicalMeasuredMap({ physical, mapping, homography }: { physical: PhysicalRowGeometryResponse | null; mapping: MetricMotorcycleMapping | null; homography: GroundPlaneHomographyResponse | null }) {
  const rows = physical?.rows.filter((row) => row.status === 'PHYSICAL_READY' && row.physical_polygon) ?? [];
  if (!rows.length) return <section className="grid min-h-80 place-items-center rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900"><div><h2 className="font-semibold">Parking map needs calibration</h2><p className="mt-1 text-sm">Parking rows, measured dimensions, and validated map calibration are required.</p></div></section>;
  const points = rows.flatMap((row) => row.physical_polygon!);
  const motorcycles = parkingMapMotorcycles(mapping);
  const roi = parkingMapRoi(homography);
  const allX = [...points.map((point) => point.x_m), ...roi.map((point) => point.x_m), ...motorcycles.map((item) => item.metric_point!.x_m)];
  const allY = [...points.map((point) => point.y_m), ...roi.map((point) => point.y_m), ...motorcycles.map((item) => item.metric_point!.y_m)];
  const minX = Math.min(...allX), maxX = Math.max(...allX), minY = Math.min(...allY), maxY = Math.max(...allY), padding = 1.5;
  const width = Math.max(maxX - minX + padding * 2, 1), height = Math.max(maxY - minY + padding * 2, 1);
  const polygon = (row: NonNullable<(typeof rows)[number]['physical_polygon']>) => row.map((point) => `${point.x_m},${-point.y_m}`).join(' ');
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="parking-map-title">
      <div className="border-b border-slate-200 px-5 py-4"><h2 id="parking-map-title" className="font-semibold">Parking map</h2><p className="mt-1 text-sm text-slate-500">Physical R1–R5 and mapped motorcycle positions</p></div>
      <div className="bg-slate-950 p-4 sm:p-6">
        <svg viewBox={`${minX - padding} ${-(maxY + padding)} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block max-h-[560px] w-full" style={{ aspectRatio: `${width} / ${height}` }} aria-label="Physical measured parking map">
          {roi.length >= 3 && <polygon points={polygon(roi)} fill="rgba(148,163,184,.04)" stroke="#94a3b8" strokeWidth="0.06" strokeDasharray="0.25 0.18" vectorEffect="non-scaling-stroke" aria-label="Parking ROI" />}
          {rows.map((row) => { const anchor = row.physical_polygon![0]; return <g key={row.row_id}><polygon points={polygon(row.physical_polygon!)} fill="rgba(59,130,246,.18)" stroke="#60a5fa" strokeWidth="0.08" vectorEffect="non-scaling-stroke" /><text x={anchor.x_m} y={-anchor.y_m - .25} fill="#dbeafe" fontSize=".48" fontWeight="700">{row.row_id.replace('row_', 'R')} · {row.measured_length_m}×{row.measured_width_m} m</text></g>; })}
          {motorcycles.map((item) => <g key={item.detection_id}><circle cx={item.metric_point!.x_m} cy={-item.metric_point!.y_m} r=".18" fill={item.physical_containment === 'INSIDE_PHYSICAL_ROW' ? '#22c55e' : item.physical_containment === 'MULTIPLE_PHYSICAL_ROWS' ? '#ef4444' : '#f59e0b'} stroke="#fff" strokeWidth=".06" /><text x={item.metric_point!.x_m + .25} y={-item.metric_point!.y_m + .16} fill="white" fontSize=".42" fontWeight="700">{item.detection_index + 1}</text></g>)}
        </svg>
      </div>
    </section>
  );
}
