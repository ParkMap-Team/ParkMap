import type { components } from '@/types/api.gen';
import { gapReasonLabels } from '@/lib/segmentationGapPresentation';

type Result = components['schemas']['IncomingVehicleRecommendation'];

export function IncomingVehicleRecommendations({ result, selectedId, onSelect }: {
  result: Result; selectedId?: string; onSelect: (id: string) => void;
}) {
  const recommended = result.candidates.filter(item => item.state === 'SLOT_CLEAR' || item.state === 'WIDTH_SUFFICIENT');
  const reasons = [...new Set([...result.reasons, ...result.candidates.flatMap(item => item.reasons)])];
  return <section aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก" data-width={result.width_m} data-allocation={result.allocation_width_m} data-recommended-count={result.recommended_count} className="space-y-3 rounded-xl border border-cyan-300 bg-cyan-50 p-4 text-sm">
    <h4 className="font-semibold">รถของคุณกว้าง {result.width_m.toFixed(3)} ม. · ต้องการรวมระยะเผื่อ {result.allocation_width_m.toFixed(3)} ม.</h4>
    <p>กว้างพอ {result.recommended_count} ช่วงทดลอง · สีเหลือง อาจจอดได้หากขยับรถ {result.almost_count} ช่วง · ยังยืนยันไม่ได้ {result.unknown_count} ช่วง</p>
    {result.almost_count > 0 && <p className="text-xs font-medium text-yellow-900">เลือกช่วงสีเหลืองบนแผนที่เพื่อดูความกว้างที่ขาด เป็นคำแนะนำที่ยังไม่พร้อมจอด และไม่รวมในรายการกว้างพอด้านล่าง</p>}
    <p className="text-xs text-slate-600">แสดงช่องสี่เหลี่ยมเต็มช่วงว่าง ลึกตามแถว ไม่แบ่งช่อง 1 ม. จำนวนช่วงไม่ใช่จำนวนรถที่จอดพร้อมกันได้ · กรอบฟ้าคือช่วงที่เลือก</p>
    {recommended.length > 0 ? <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">{recommended.map((item, index) => <button key={item.id} type="button" data-incoming-placement={item.id} aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)} className={`rounded border bg-white p-2 text-left ${item.id === selectedId ? 'border-cyan-700 ring-2 ring-cyan-600' : 'border-cyan-200'}`}>
      {item.row_id} · ช่วง {index+1} · แนววัดกว้าง {item.gap_width_m.toFixed(2)} ม.{item.slot_length_m != null ? ` × ลึก ${item.slot_length_m.toFixed(2)} ม.` : ''}
      {item.depth_at_width_midpoint_m != null && <span className="w-full text-xs">ลึกตรงกลางแนววัด {item.depth_at_width_midpoint_m.toFixed(2)} ม. · ไม่ใช่ความลึกตลอดความกว้าง</span>}
    </button>)}</div> : <p className="font-medium text-amber-900">ยังไม่พบตำแหน่งที่ผ่านเกณฑ์สำหรับความกว้างนี้{reasons.length > 0 ? ` · ${reasons.map(reason => gapReasonLabels[reason] ?? reason).join(' · ')}` : ' พื้นที่ต่อเนื่องอาจกว้างไม่พอ'}</p>}
    <p className="text-xs text-amber-900">ความลึกที่แสดงเป็นข้อมูลประกอบ ยังไม่ตรวจความยาวรถ ทางเข้าหรือการเลี้ยว ผลนี้เป็นคำแนะนำตามแบบจำลอง ไม่ใช่การรับรองว่าจอดได้จริง</p>
    {result.truncated && <p className="text-xs text-amber-800">ผลลัพธ์มีจำนวนมาก แสดงเฉพาะชุดแรก</p>}
  </section>;
}
