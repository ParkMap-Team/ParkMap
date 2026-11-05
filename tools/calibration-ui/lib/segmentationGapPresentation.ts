import type { components } from '../types/api.gen';

type State = components['schemas']['GapCandidate']['state'];

export const gapReasonLabels: Record<string, string> = {
  GROUND_MAY_BE_OCCLUDED: 'ตำแหน่งนี้อาจถูกบังในภาพกล้อง',
  ROW_UNCERTAIN: 'ข้อมูลแถวยังไม่แน่นอน',
  FOOTPRINT_NOT_PROVEN: 'ช่องไม่ผ่านขอบแถว/ROI หรือทับสิ่งกีดขวาง',
  FULL_DEPTH_CORRIDOR_NOT_PROVEN: 'ยังยืนยันแนววัดช่องว่างไม่ได้',
  PROJECTION_OUTSIDE_VALID_IMAGE: 'ฉายตำแหน่งออกนอกภาพ',
  NO_SEGMENTATION_EVIDENCE_IN_ROI: 'ไม่มีหลักฐานรถจาก segmentation ใน ROI',
  CURRENT_MATCHING_CALIBRATION_REQUIRED: 'ต้องคำนวณ calibration ให้ตรงกับภาพและแถวปัจจุบัน',
  SEGMENTATION_UNAVAILABLE: 'segmentation ยังใช้งานไม่ได้',
  INVALID_IMAGE_PROJECTION: 'การฉายตำแหน่งไม่ถูกต้อง',
  WIDTH_BELOW_TARGET: 'ความกว้างไม่ถึงเกณฑ์',
};

// Presentation of Python-owned decisions; no width/fitting decisions in the UI.
export const gapPresentation: Record<State, { label: string; color: string; fill: string }> = {
  SLOT_CLEAR: { label: 'ช่องจำลองว่าง (ทดลอง)', color: '#16a34a', fill: '#86efac' },
  FIT: { label: 'วางกรอบรถได้ (ทดลอง)', color: '#16a34a', fill: '#86efac' },
  WIDTH_SUFFICIENT: { label: 'กว้างพอ', color: '#16a34a', fill: '#86efac' },
  INSUFFICIENT_WIDTH: { label: 'แคบเกินไป', color: '#dc2626', fill: '#fecaca' },
  UNKNOWN: { label: 'ยังยืนยันไม่ได้', color: '#64748b', fill: '#94a3b8' },
};
