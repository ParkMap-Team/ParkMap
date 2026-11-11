import type { components } from '@/types/api.gen';

type Vehicle = components['schemas']['HorizontalVehicleClearance'];
export type HorizontalVehicleControl = {
  enabled: boolean; selectedId?: string;
  onToggle: (enabled: boolean) => void; onSelect: (id: string) => void;
};
const metricPath = (points: Vehicle['polygon_metric']) => points.length ? `M${points.map(p => `${p.x_m},${p.y_m}`).join(' L')} Z` : '';
const imagePath = (points: Vehicle['polygon_image']) => points?.length ? `M${points.map(p => `${p.x},${p.y}`).join(' L')} Z` : '';
const statusLabels: Record<Vehicle['measurement_status'], string> = {
  APPROXIMATE_REFERENCE: 'ระยะประมาณระหว่างกรอบอ้างอิง',
  OUTSIDE_CALIBRATED_ROI: 'กรอบหรือแนววัดออกนอกพื้นที่ calibration จึงไม่แสดงระยะ',
  PROJECTION_UNAVAILABLE: 'ฉายพิกัดไม่ได้ จึงไม่แสดงระยะ',
  NO_COMPARABLE_NEIGHBOR: 'ยังไม่มีรถข้างเคียงที่เปรียบเทียบได้ใน ROI',
};

export function HorizontalVehiclePanel({ vehicles, control }: { vehicles: Vehicle[]; control: HorizontalVehicleControl }) {
  const selected = vehicles.find(item => item.detection_id === control.selectedId);
  return <section className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-4 text-sm" aria-label="รถแนวนอนและระยะถึงรถข้างเคียง">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={control.enabled} onChange={event => control.onToggle(event.target.checked)} />แสดงรถที่คาดว่าเป็นแนวนอน แม้อยู่นอกแถว</label>
    <p>คาดว่าแนวนอน {vehicles.length} คัน · กรอบส้มเส้นประ = รถแนวนอนอ้างอิง · กรอบน้ำเงิน = รถข้างเคียงที่เลือกเปรียบเทียบ</p>
    <p className="text-xs leading-relaxed text-amber-950">เดาจากสัดส่วนกรอบภาพ ไม่ใช่แนวรถจริงที่ยืนยันแล้ว · ใช้ขนาดอ้างอิง 0.66 × 2.00 ม. · ระยะเป็นค่าประมาณระหว่างกรอบ ไม่ใช่ขนาดรถจริงหรือระยะวัดหน้างาน · ไม่เปลี่ยนช่องสีเขียวหรือผล LIFF</p>
    <p className="text-xs text-slate-600">เทียบเฉพาะรถที่แนวชัดพอและกรอบอยู่ใน ROI ที่ calibration รองรับ รถที่ถูกบัง/ตรวจพลาดอาจไม่รวมอยู่ในผลนี้</p>
    {!vehicles.length && <p>รอบนี้ยังไม่มีกรอบที่คาดว่าเป็นแนวนอน</p>}
    {selected && <div data-horizontal-detail={selected.detection_id} data-horizontal-status={selected.measurement_status} className="space-y-1 rounded-lg border border-orange-200 bg-white p-3">
      <h4 className="font-semibold">{selected.detection_id} · ไม่จำเป็นต้องมีแถวเจ้าของ</h4>
      <p>{selected.clearance_m != null ? `ถึง ${selected.nearest_detection_id} · ≈ ${selected.clearance_m.toFixed(2)} ม.` : statusLabels[selected.measurement_status]}</p>
      {selected.clearance_m === 0 && <p className="text-amber-900">กรอบอ้างอิงทับกัน ไม่ใช่หลักฐานว่ารถจริงชนหรือทับกัน</p>}
      {selected.excluded_neighbor_count > 0 && <p className="text-xs text-slate-500">มีรถอีก {selected.excluded_neighbor_count} คันที่ไม่นำมาเทียบ เพราะพิกัด/แนวหรือขอบเขตยังไม่รองรับ</p>}
    </div>}
    <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">{vehicles.map(item => <button type="button" key={item.detection_id} data-horizontal-choice={item.detection_id} aria-pressed={item.detection_id === control.selectedId} onClick={() => control.onSelect(item.detection_id)}
      className={`rounded-lg border bg-white px-3 py-2 text-left ${item.detection_id === control.selectedId ? 'border-orange-600 ring-1 ring-orange-500' : 'border-orange-200'}`}>
      {item.detection_id} · {item.clearance_m != null ? `≈ ${item.clearance_m.toFixed(2)} ม.` : 'ยังวัดไม่ได้'}
    </button>)}</div>
  </section>;
}

export function HorizontalVehicleMetricOverlay({ vehicles, control, unit, clipId }: {
  vehicles: Vehicle[]; control: HorizontalVehicleControl; unit: number; clipId: string;
}) {
  const selected = vehicles.find(item => item.detection_id === control.selectedId);
  const line = selected?.line_metric;
  const midpoint = line?.length === 2 ? { x: (line[0].x_m+line[1].x_m)/2, y: (line[0].y_m+line[1].y_m)/2 } : undefined;
  return <g clipPath={`url(#${clipId})`}>
    {vehicles.map(item => <path key={item.detection_id} data-horizontal-vehicle={item.detection_id} d={metricPath(item.polygon_metric)} fill={item.detection_id === control.selectedId ? 'rgba(249,115,22,.2)' : 'none'} stroke="#ea580c" strokeWidth={unit*.22} strokeDasharray={`${unit*.4} ${unit*.2}`} pointerEvents="stroke"
      role="button" tabIndex={0} aria-label={`รถแนวนอนอ้างอิง ${item.detection_id}`} onClick={() => control.onSelect(item.detection_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.onSelect(item.detection_id); } }}><title>{item.detection_id} · คาดว่าแนวนอน · กรอบอ้างอิง ไม่ใช่รถจริง</title></path>)}
    {selected && <g className="pointer-events-none">
      <path data-horizontal-neighbor={selected.nearest_detection_id ?? undefined} d={metricPath(selected.neighbor_polygon_metric)} fill="none" stroke="#2563eb" strokeWidth={unit*.15} strokeDasharray={`${unit*.3} ${unit*.2}`} />
      {line?.length === 2 && <line data-horizontal-distance={selected.detection_id} x1={line[0].x_m} y1={line[0].y_m} x2={line[1].x_m} y2={line[1].y_m} stroke="#0369a1" strokeWidth={unit*.2} />}
      {midpoint && selected.clearance_m != null && <text x={midpoint.x} y={midpoint.y+unit*.45} transform={`translate(0 ${2*(midpoint.y+unit*.45)}) scale(1 -1)`} textAnchor="middle" fontSize={unit*1.6} fill="#075985" stroke="white" strokeWidth={unit*.08} paintOrder="stroke">≈ {selected.clearance_m.toFixed(2)} ม.</text>}
    </g>}
  </g>;
}

export function HorizontalVehicleImageOverlay({ vehicles, control }: { vehicles: Vehicle[]; control: HorizontalVehicleControl }) {
  const selected = vehicles.find(item => item.detection_id === control.selectedId);
  const line = selected?.line_image;
  return <g className="pointer-events-none">
    {vehicles.map(item => <path key={item.detection_id} data-image-horizontal-vehicle={item.detection_id} d={imagePath(item.polygon_image)} fill="none" stroke="#ea580c" strokeWidth=".002" strokeDasharray=".006 .003" />)}
    {selected && <path d={imagePath(selected.neighbor_polygon_image)} fill="none" stroke="#2563eb" strokeWidth=".002" strokeDasharray=".004 .002" />}
    {line?.length === 2 && <g><line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} stroke="#0284c7" strokeWidth=".003" />
      <text x={(line[0].x+line[1].x)/2} y={(line[0].y+line[1].y)/2-.008} textAnchor="middle" fontSize=".014" fill="#075985" stroke="white" strokeWidth=".001" paintOrder="stroke">≈ {selected?.clearance_m?.toFixed(2)} ม.</text></g>}
  </g>;
}
