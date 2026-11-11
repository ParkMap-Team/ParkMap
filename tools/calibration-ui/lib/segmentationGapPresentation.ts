import type { components } from '../types/api.gen';

type State = components['schemas']['GapCandidate']['state'];

export const widthPreviewLabel = 'กว้างพอ · ยังไม่ยืนยันว่าจอดได้';

export function isWidthPreview(gap: components['schemas']['GapCandidate'], enabled: boolean) {
  return enabled && gap.state === 'UNKNOWN' && gap.width_check === 'SUFFICIENT';
}

export const gapReasonLabels: Record<string, string> = {
  GROUND_MAY_BE_OCCLUDED: 'ตำแหน่งนี้อาจถูกบังในภาพกล้อง',
  ROW_UNCERTAIN: 'ข้อมูลแถวยังไม่แน่นอน',
  LOCAL_ROW_UNCERTAINTY: 'อยู่ในบริเวณเผื่อของรถที่จัดแถวไม่ชัดเจน',
  AMBIGUOUS_ROW_ASSIGNMENT: 'กรอบรถทับหลายแถว จัดแถวไม่ได้ชัดเจน',
  UNASSIGNED_ROW_INTERSECTION: 'กรอบรถทับแถว แต่ยังจัดรถเข้าแถวนั้นไม่ได้',
  FOOTPRINT_NOT_PROVEN: 'ช่องไม่ผ่านขอบแถว/ROI หรือทับสิ่งกีดขวาง',
  FULL_DEPTH_CORRIDOR_NOT_PROVEN: 'ยังยืนยันแนววัดช่องว่างไม่ได้',
  PROJECTION_OUTSIDE_VALID_IMAGE: 'ฉายตำแหน่งออกนอกภาพ',
  NO_SEGMENTATION_EVIDENCE_IN_ROI: 'ไม่มีหลักฐานรถจาก segmentation ใน ROI',
  CURRENT_MATCHING_CALIBRATION_REQUIRED: 'ต้องคำนวณ calibration ให้ตรงกับภาพและแถวปัจจุบัน',
  SEGMENTATION_UNAVAILABLE: 'segmentation ยังใช้งานไม่ได้',
  INVALID_IMAGE_PROJECTION: 'การฉายตำแหน่งไม่ถูกต้อง',
  WIDTH_BELOW_TARGET: 'ความกว้างไม่ถึงเกณฑ์',
  WIDTH_NOT_PROVEN: 'ยังไม่พบแนววัดภายในรูปทรงที่กว้างพอ',
  VISIBILITY_PARTITION_NOT_PROVEN: 'ยังแยกส่วนที่มองเห็นกับส่วนที่ถูกบังได้ไม่ครบ',
  SMALL_OCCUPIED_CONFLICT: 'ขาดความกว้างเล็กน้อยและมีรถข้างเคียงล้ำเข้ากรอบเป้าหมาย · อาจจอดได้หากขยับรถ',
  NO_FULL_DEPTH_CANDIDATE: 'ไม่มีช่วงว่างตลอดความลึกแถวที่ถูกสร้างไว้ตรงนี้',
  NO_CANDIDATE_AT_LOCATION: 'ตำแหน่งนี้ไม่มีช่องที่ระบบประเมินและแสดงไว้',
  CANDIDATE_LIMIT_REACHED: 'ผลรอบนี้ถึงขีดจำกัดรายการ พื้นที่นี้ยังไม่มีช่องที่แสดง',
};

// Presentation of Python-owned decisions; no width/fitting decisions in the UI.
export const gapPresentation: Record<State, { label: string; color: string; fill: string }> = {
  ALMOST_AVAILABLE: { label: 'อาจจอดได้หากขยับรถข้างเคียง', color: '#a16207', fill: '#fde047' },
  SLOT_CLEAR: { label: 'ช่องจำลองว่าง (ทดลอง)', color: '#16a34a', fill: '#86efac' },
  FIT: { label: 'วางกรอบรถได้ (ทดลอง)', color: '#16a34a', fill: '#86efac' },
  WIDTH_SUFFICIENT: { label: 'กว้างพอ', color: '#16a34a', fill: '#86efac' },
  INSUFFICIENT_WIDTH: { label: 'แคบเกินไป', color: '#dc2626', fill: '#fecaca' },
  UNKNOWN: { label: 'ยังยืนยันไม่ได้', color: '#64748b', fill: '#94a3b8' },
};
