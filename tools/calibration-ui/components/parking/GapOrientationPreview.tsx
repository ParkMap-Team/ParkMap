import type { components } from '@/types/api.gen';

type Hypothesis = components['schemas']['GapOrientationHypothesis'];
type Gaps = components['schemas']['SegmentationGapResult'];
export type OrientationPreviewControl = {
  enabled: boolean; selectedId?: string;
  onToggle: (enabled: boolean) => void; onSelect: (id: string) => void;
};
const labels: Record<Hypothesis['image_orientation'], string> = {
  HORIZONTAL_IMAGE: 'คาดว่าแนวนอนจากภาพ', VERTICAL_IMAGE: 'คาดว่าแนวตั้งจากภาพ', AMBIGUOUS_IMAGE: 'แนวไม่แน่นอน',
};
const visible = (items: Hypothesis[], selectedId?: string) => items.filter(item => item.image_orientation === 'HORIZONTAL_IMAGE' || item.detection_id === selectedId);
const path = (rings: { x_m: number; y_m: number }[][]) => rings.map(ring => ring.length ? `M${ring.map(p => `${p.x_m},${p.y_m}`).join(' L')} Z` : '').join(' ');
const imagePath = (rings: { x: number; y: number }[][]) => rings.map(ring => ring.length ? `M${ring.map(p => `${p.x},${p.y}`).join(' L')} Z` : '').join(' ');

export function OrientationMetricOverlay({ hypotheses, control, unit, clipId }: {
  hypotheses: Hypothesis[]; control: OrientationPreviewControl; unit: number; clipId?: string;
}) {
  return <g clipPath={clipId ? `url(#${clipId})` : undefined}>{visible(hypotheses, control.selectedId).flatMap(item => item.geometry?.polygons.map((rings, index) => <path
    key={`${item.detection_id}-${index}`} data-orientation-hypothesis={item.detection_id} data-orientation-kind={item.image_orientation}
    d={path(rings)} fill="none" stroke="#0e7490" strokeWidth={unit*(item.detection_id === control.selectedId ? .4 : .22)} strokeDasharray={`${unit*.45} ${unit*.25}`} pointerEvents="stroke"
    role="button" tabIndex={0} aria-label={`กรอบแนวรถทดลอง ${item.detection_id}`} onClick={() => control.onSelect(item.detection_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.onSelect(item.detection_id); } }}>
    <title>{item.detection_id} · {labels[item.image_orientation]} · หมุนกรอบทดลอง {item.proposed_rotation_deg}° ไม่ใช่แนวรถจริงบนพื้น</title>
  </path>) ?? [])}</g>;
}

export function OrientationImageOverlay({ hypotheses, control }: { hypotheses: Hypothesis[]; control: OrientationPreviewControl }) {
  return <g>{visible(hypotheses, control.selectedId).flatMap(item => item.image_geometry?.polygons.map((rings, index) => <path
    key={`${item.detection_id}-${index}`} data-image-orientation-hypothesis={item.detection_id} d={imagePath(rings)} fill="none" stroke="#0e7490" strokeWidth={item.detection_id === control.selectedId ? 3.5 : 2} strokeDasharray="7 4" vectorEffect="non-scaling-stroke" pointerEvents="stroke"
    role="button" tabIndex={0} aria-label={`ภาพแนวรถทดลอง ${item.detection_id}`} onClick={() => control.onSelect(item.detection_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.onSelect(item.detection_id); } }}>
    <title>{item.detection_id} · {labels[item.image_orientation]} · เป็นกรอบทดลอง</title>
  </path>) ?? [])}</g>;
}

export function GapOrientationPreview({ gaps, control }: { gaps: Gaps; control: OrientationPreviewControl }) {
  const selected = gaps.orientation_hypotheses.find(item => item.detection_id === control.selectedId);
  return <section aria-label="ผลทดลองแนวรถจากกรอบภาพ" className="space-y-3 rounded-xl border border-cyan-500 bg-cyan-50 p-4 text-sm">
    <h4 className="font-semibold">ทดลองเดาแนวรถจากสัดส่วนกรอบภาพ · เฉพาะกรอบที่อยู่ใน ROI เดิม</h4>
    <p>คาดแนวนอน {gaps.orientation_hypotheses.filter(item => item.image_orientation === 'HORIZONTAL_IMAGE').length} กรอบ · คาดแนวตั้ง {gaps.orientation_hypotheses.filter(item => item.image_orientation === 'VERTICAL_IMAGE').length} กรอบ · ไม่แน่นอน {gaps.orientation_hypotheses.filter(item => item.image_orientation === 'AMBIGUOUS_IMAGE').length} กรอบ</p>
    <p className="text-xs">ใช้ความกว้าง/สูงเป็นพิกเซล: ≥ {gaps.orientation_ratio_threshold.toFixed(2)} เสนอหมุน 90° · ≤ {(1/gaps.orientation_ratio_threshold).toFixed(2)} คงแนวเดิม · ระหว่างนั้นไม่เสนอแนว</p>
    <p className="font-medium text-amber-950">แดง = กรอบที่ใช้คำนวณเดิม · ฟ้าเส้นประ = กรอบทดลองหมุนรอบศูนย์กลางเดิม · เป็นการเดาจากภาพ ยังไม่ใช้เปลี่ยนช่องเขียว/เหลือง หรือผล LIFF</p>
    {selected && <p data-selected-orientation={selected.detection_id} className="rounded border border-cyan-300 bg-white p-3">{selected.detection_id} · {labels[selected.image_orientation]} · กว้าง/สูง {selected.pixel_aspect_ratio.toFixed(2)} · {selected.proposed_rotation_deg == null ? 'ไม่เสนอการหมุนกรอบ' : `กรอบทดลอง ${selected.proposed_rotation_deg}°`}</p>}
    <div className="grid max-h-40 gap-2 overflow-auto sm:grid-cols-2">{gaps.orientation_hypotheses.map(item => <button key={item.detection_id} type="button" data-orientation-choice={item.detection_id} aria-pressed={item.detection_id === control.selectedId} onClick={() => control.onSelect(item.detection_id)} className="rounded border border-cyan-200 bg-white p-2 text-left">
      {item.detection_id} · {labels[item.image_orientation]} · {item.pixel_aspect_ratio.toFixed(2)}
    </button>)}</div>
  </section>;
}
