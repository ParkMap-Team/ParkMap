import type { components } from '@/types/api.gen';
import { gapReasonLabels } from '@/lib/segmentationGapPresentation';

type Result = components['schemas']['IncomingVehicleRecommendation'];

export function IncomingVehicleRecommendations({ result, selectedId, onSelect }: {
  result: Result; selectedId?: string; onSelect: (id: string) => void;
}) {
  const recommended = result.candidates.filter(item => item.state === 'SLOT_CLEAR');
  const reasons = [...new Set([...result.reasons, ...result.candidates.flatMap(item => item.reasons)])];
  return <section aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก" data-width={result.width_m} data-allocation={result.allocation_width_m} data-recommended-count={result.recommended_count} className="space-y-3 rounded-xl border border-cyan-300 bg-cyan-50 p-4 text-sm">
    <h4 className="font-semibold">รถของคุณกว้าง {result.width_m.toFixed(3)} ม. · จัดพื้นที่กว้าง {result.allocation_width_m.toFixed(3)} ม.</h4>
    <p>แนะนำได้ {result.recommended_count} ตำแหน่งทดลอง · ยังยืนยันไม่ได้ {result.unknown_count} ตำแหน่ง</p>
    <p className="text-xs text-slate-600">พื้นที่ขั้นต่ำ 1 ม. รถที่กว้างกว่าใช้พื้นที่ต่อเนื่องตามค่ากรอก คร่อมเส้นแบ่งได้ · กรอบฟ้าคือตำแหน่งสำหรับรถคันนี้ เลือกกรอบหรือรายการด้านล่างได้</p>
    {recommended.length > 0 ? <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">{recommended.map((item, index) => <button key={item.id} type="button" data-incoming-placement={item.id} aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)} className={`rounded border bg-white p-2 text-left ${item.id === selectedId ? 'border-cyan-700 ring-2 ring-cyan-600' : 'border-cyan-200'}`}>
      {item.row_id} · ตำแหน่ง {index+1} · {item.gap_width_m.toFixed(2)} × {item.slot_length_m?.toFixed(2)} ม.
    </button>)}</div> : <p className="font-medium text-amber-900">ยังไม่พบตำแหน่งที่ผ่านเกณฑ์สำหรับความกว้างนี้{reasons.length > 0 ? ` · ${reasons.map(reason => gapReasonLabels[reason] ?? reason).join(' · ')}` : ' พื้นที่ต่อเนื่องอาจกว้างไม่พอ'}</p>}
    <p className="text-xs text-amber-900">ความลึกตามแถว ยังไม่ตรวจความยาวรถ ทางเข้าหรือการเลี้ยว ผลนี้เป็นคำแนะนำตามแบบจำลอง ไม่ใช่การรับรองว่าจอดได้จริง</p>
    {result.truncated && <p className="text-xs text-amber-800">ผลลัพธ์มีจำนวนมาก แสดงเฉพาะชุดแรก</p>}
  </section>;
}
