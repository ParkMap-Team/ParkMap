import type { components } from '@/types/api.gen';

type Gap = components['schemas']['GapCandidate'];

export function GapFamilyRecommendations({ gap, error }: { gap?: Gap; error?: string | null }) {
  if (!gap) return null;
  return <section aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก" data-gap-id={gap.id} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
    <h4 className="font-semibold">รุ่นรถสำหรับช่องที่เลือก · {gap.row_id} · กว้าง {gap.gap_width_m.toFixed(3)} ม.{gap.slot_length_m != null ? ` × ลึก ${gap.slot_length_m.toFixed(3)} ม. ตามแถว` : ''}</h4>
    {gap.state !== 'WIDTH_SUFFICIENT' && gap.state !== 'SLOT_CLEAR' ? <p>ยังไม่แนะนำรุ่นรถสำหรับช่องนี้ เพราะไม่ใช่ช่องสีเขียวที่ผ่านการตรวจความกว้าง</p>
      : error ? <p role="alert" className="text-amber-800">อ่านขนาดรถอ้างอิงไม่ได้ กรุณาตรวจไฟล์ motorcycle_reference_sizes.json แล้วกด Analyze ใหม่</p>
      : <>
        <p className="font-medium text-green-800">ความกว้างเพียงพอตามค่าอ้างอิง: {gap.compatible_families.length} รุ่น</p>
        <p className="text-xs text-amber-900">ตรวจเฉพาะความกว้าง ไม่ตรวจความยาวหรือทางเข้า–ออก ขนาดรายรุ่นเป็นค่าอ้างอิง ไม่ใช่การวัดรถจากภาพ รุ่นในรายการเป็นตัวเลือกแยกกัน ไม่ใช่จำนวนรถที่จอดพร้อมกันได้</p>
        {gap.compatible_families.length > 0 ? <ul className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
          {gap.compatible_families.map(item => <li key={item.family} data-compatible-family={item.family} className="rounded-lg border border-green-200 bg-white p-3">
            <strong className="uppercase">{item.family.replaceAll('_', ' ')}</strong>
            <p>กว้าง {item.width_m.toFixed(3)} ม. · เหลือด้านข้างรวม {item.width_clearance_m.toFixed(3)} ม.</p>
            <p className="break-words text-xs text-slate-500">{item.basis === 'INITIAL_STANDARD_NOT_MEASURED' ? 'ขนาดอ้างอิง ยังไม่ยืนยันการวัดจริง' : `ที่มาขนาดอ้างอิง: ${item.basis}`}</p>
          </li>)}
        </ul> : <p>ไม่มีรุ่นในไฟล์อ้างอิงที่มีความกว้างพอกับช่องนี้</p>}
      </>}
  </section>;
}
