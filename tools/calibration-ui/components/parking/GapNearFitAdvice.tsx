import type { components } from '@/types/api.gen';

export function GapNearFitAdvice({ gap }: { gap?: components['schemas']['GapCandidate'] }) {
  if (gap?.state !== 'ALMOST_AVAILABLE' || !gap.near_fit) return null;
  const advice = gap.near_fit;
  return <section aria-label="คำแนะนำสีเหลือง" className="space-y-2 rounded-lg border border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-950">
    <h4 className="font-semibold">อาจจอดได้หากขยับรถข้างเคียง · ยังจอดไม่ได้ทันที</h4>
    <p>ขาดความกว้างรวมระยะเผื่อ {(advice.required_extra_width_m * 100).toFixed(1)} ซม. · กรอบเป้าหมายทับพื้นที่รถอ้างอิง {(advice.occupied_overlap_ratio * 100).toFixed(1)}%</p>
    <p className="text-xs">กรอบประสีเหลืองคือพื้นที่เป้าหมายตามแบบจำลอง รถอ้างอิงที่เกี่ยวข้อง: {advice.conflicting_detection_ids.join(', ')}</p>
    <p className="text-xs font-medium">เป็นคำแนะนำทดลอง ยังไม่ได้คำนวณแผนขยับรถ และยังไม่ตรวจความยาวรถหรือทางเข้า–ออก</p>
  </section>;
}
