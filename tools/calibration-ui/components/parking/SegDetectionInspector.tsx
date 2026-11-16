"use client";

import type { components } from '@/types/api.gen';
import { segDetectionInspection } from '@/lib/segDetectionInspection';

type Result = components['schemas']['SegmentationExperimentResult'];
type Gaps = components['schemas']['SegmentationGapResult'];

export function SegDetectionHitTargets({ result, selectedIndex, onSelect }: {
  result: Result; selectedIndex?: number; onSelect: (index: number) => void;
}) {
  return <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="เลือกรถ Seg เพื่อตรวจแถว">
    {result.detections.map((item, index) => {
      const bbox = item.bbox;
      const polygon = item.polygon?.length && item.polygon.length >= 3 ? item.polygon : [
        { x: bbox.x, y: bbox.y }, { x: bbox.x+bbox.width, y: bbox.y },
        { x: bbox.x+bbox.width, y: bbox.y+bbox.height }, { x: bbox.x, y: bbox.y+bbox.height },
      ];
      const selected = index === selectedIndex;
      return <polygon key={index} data-inspect-detection={`detection_${index+1}`} points={polygon.map(p => `${p.x},${p.y}`).join(' ')}
        role="button" tabIndex={0} aria-label={`ตรวจรถ detection_${index+1}`} aria-pressed={selected}
        className="pointer-events-auto cursor-pointer focus:outline-none focus:stroke-orange-600" fill={selected ? 'rgba(249,115,22,.25)' : 'transparent'}
        stroke={selected ? '#ea580c' : 'transparent'} strokeWidth=".004" pointerEvents="all"
        onClick={() => onSelect(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index); } }}>
        <title>detection_{index+1} · คลิกดูแถวและเหตุผล</title>
      </polygon>;
    })}
  </svg>;
}

export function SegDetectionInspector({ result, gaps, selectedIndex, onSelect, onClose }: {
  result: Result; gaps?: Gaps | null; selectedIndex?: number; onSelect: (index: number) => void; onClose: () => void;
}) {
  const detection = selectedIndex == null ? undefined : result.detections[selectedIndex];
  const info = detection && selectedIndex != null ? segDetectionInspection(selectedIndex, gaps) : undefined;
  const layer = info?.layer;
  const assignment = info?.assignment;
  const assignmentReasonLabels: Record<string, string> = {
    ASSIGNED_BY_NEAREST_IMAGE_EDGE: 'เส้นล่างของแถวนี้ใกล้จุดกึ่งกลางล่างที่สุดบนภาพ จึงกันพื้นที่ในแถวนี้เพียงแถวเดียว',
    AMBIGUOUS_IMAGE_EDGES: 'ใกล้เส้นล่างสองแถวพอ ๆ กัน ระยะต่างกันไม่เกิน 5% ของความลึกแถวบนภาพ จึงยังไม่เลือกเจ้าของ',
    ASSIGNED_BY_IMAGE_POINT: 'จุดกึ่งกลางล่างอยู่ในกรอบแถวบนภาพ จึงจัดเข้าแถวนั้นโดยไม่ใช้ระยะตัดออก',
    ASSIGNED_BY_IMAGE_MASK: 'จุดอยู่นอกกรอบแถว ใช้ mask ที่ผ่านการตรวจช่วยเลือกเจ้าของแถวเดียว',
    AMBIGUOUS_IMAGE_ROWS: 'จุดอยู่ในกรอบแถวที่ซ้อนกัน หรือ mask ช่วยเลือกได้หลายแถวพอ ๆ กัน จึงยังไม่ยืนยันเจ้าของ',
    NO_USABLE_MASK_FOR_ROW: 'จุดอยู่นอกกรอบแถว และไม่มี mask ที่ผ่านการตรวจช่วยเลือกแถว',
    NO_ROW_IMAGE_EVIDENCE: 'จุดอยู่นอกกรอบแถว และ mask ไม่ทับแถวใน ROI ถึงเกณฑ์ 10%',
    ASSIGNED: 'จุดกึ่งกลางล่างใกล้เส้นล่างของแถวนี้ที่สุดและผ่านเกณฑ์',
    ASSIGNED_WITH_MASK: 'เลือกแถวใกล้ที่สุดโดยมี mask ทับแถวช่วยยืนยัน ยังเป็นค่าประมาณ',
    ASSIGNED_NEAR_ROI_WITH_MASK: 'จุดล่างเลย ROI ไม่เกิน 40 ซม. และมี mask ที่ใช้ได้ทับแถวช่วยยืนยัน',
    OUTSIDE_ROI: 'จุดล่างอยู่นอก ROI และไม่ผ่านข้อยกเว้น mask ช่วยยืนยันภายใน 40 ซม.',
    OUTSIDE_ROW_SPAN: 'จุดกึ่งกลางล่างเลยช่วงความกว้างของเส้นแถวที่เลือกไว้',
    TOO_FAR_FROM_EDGE: 'จุดล่างเกินเกณฑ์ปกติ 20 ซม. และไม่ผ่านเงื่อนไข mask ช่วยยืนยันภายในครึ่งความลึกแถว',
    AMBIGUOUS_NEAREST_EDGE: 'ใกล้เส้นล่างสองแถวพอ ๆ กัน ระยะต่างกันไม่ถึง 10 ซม.',
    INVALID_REFERENCE: 'ข้อมูลจุดหรือกรอบอ้างอิงใช้คำนวณไม่ได้',
    NO_ROW_AREA: 'พื้นที่อ้างอิงที่สร้างไม่เหลือพื้นที่ภายในแถวและ ROI',
    UNRESOLVED: 'ยังไม่มีเหตุผลการจัดแถวที่ชัดเจน',
  };
  return <section className="space-y-3 border-t bg-orange-50/50 p-4 text-sm" aria-label="ตรวจรถที่ Seg ตรวจพบ">
    <label className="flex flex-wrap items-center gap-2 font-medium">ตรวจรถที่ Seg พบ
      <select aria-label="เลือกรถที่ Seg ตรวจพบ" className="rounded border bg-white p-2" value={selectedIndex ?? ''} onChange={event => event.target.value === '' ? onClose() : onSelect(Number(event.target.value))}>
        <option value="">กดรถบนภาพ หรือเลือก ID</option>
        {result.detections.map((_, index) => <option key={index} value={index}>detection_{index+1}</option>)}
      </select>
    </label>
    {info && detection && <div role="status" data-detection-inspection={info.id} data-assignment-reason={assignment?.reason ?? layer?.row_assignment_reason} className="space-y-2 rounded-xl border border-orange-200 bg-white p-3">
      <h3 className="font-semibold">{info.id} · {layer?.assigned_row_id ?? 'ยังไม่มีแถวที่ระบบยืนยันให้'}</h3>
      <p>Seg ตรวจพบ · ความมั่นใจ {(detection.confidence*100).toFixed(1)}% · {detection.polygon?.length ? 'Seg ส่ง mask มา (ยังไม่ยืนยันว่า mask ผ่านการตรวจรูปทรง)' : 'ไม่มี mask ใช้กรอบตรวจจับสำรอง'}</p>
      <p>จุดกึ่งกลางล่างในภาพ: x {((detection.bbox.x+detection.bbox.width/2)*result.image_width).toFixed(0)}, y {((detection.bbox.y+detection.bbox.height)*result.image_height).toFixed(0)} พิกเซล (จุดสีเหลือง)</p>
      {info.status === 'ASSIGNED' && <p>ระบบจัดเข้า <strong>{layer?.assigned_row_id}</strong> · {layer?.row_assignment_source === 'IMAGE_NEAREST_EDGE' || layer?.row_assignment_source === 'IMAGE_POINT' || layer?.row_assignment_source === 'IMAGE_MASK' ? assignmentReasonLabels[layer.row_assignment_reason] : layer?.row_assignment_source === 'BOTTOM_EDGE_APPROXIMATE' ? 'เทียบจุดกึ่งกลางล่างกับเส้นล่างของแถว (ค่าประมาณ)' : layer?.row_assignment_source === 'NEAREST_APPROXIMATE' ? 'จัดเข้าแถวใกล้ที่สุดแบบประมาณ' : 'ตามจุดอ้างอิงของรถ'}</p>}
      {layer?.row_assignment_source === 'MASK_SUPPORTED_NEAREST_EDGE' && <p>{layer.row_assignment_reason === 'ASSIGNED_NEAR_ROI_WITH_MASK' ? 'จุดล่างเลย ROI แต่ห่างขอบ ROI และเส้นล่างแถวไม่เกิน 40 ซม. มี mask ที่ใช้ได้ทับแถวอย่างน้อย 10%' : 'mask ทับแถวที่เลือกอย่างน้อย 10% และจุดล่างอยู่ภายในแถวนั้น · รับระยะได้ถึงครึ่งความลึกแถว'} · กันพื้นที่เฉพาะภายในแถวนี้และ ROI เดิม ยังเป็นค่าประมาณ</p>}
      {info.status === 'UNRESOLVED' && <p>มีรถคันนี้ในผลคำนวณ แต่ยังเลือกแถวไม่ได้ชัดเจน จึงเก็บเป็นข้อมูลไม่แน่นอน ไม่ถือว่าพื้นที่ว่าง</p>}
      {info.status === 'EXCLUDED' && <p>รถคันนี้ไม่ถูกสร้างเป็นพื้นที่แดงบนแผนที่ · {gaps?.occupancy_scope === 'BOTTOM_EDGE_ANCHOR' || gaps?.occupancy_scope === 'IMAGE_NEAREST_LOWER_EDGE' || gaps?.occupancy_scope === 'IMAGE_ROW_POINT_OR_MASK' ? assignment?.reason === 'OUTSIDE_ROI' && gaps?.occupancy_scope === 'IMAGE_NEAREST_LOWER_EDGE' ? 'จุดล่างอยู่นอก ROI เกินระยะเผื่อ 40 ซม.' : assignmentReasonLabels[assignment?.reason ?? 'UNRESOLVED'] ?? assignment?.reason : gaps?.occupancy_scope === 'GROUND_ANCHOR_OR_ROW_MASK' ? 'จุดกึ่งกลางล่างไม่ผ่านเกณฑ์จัดแถว และไม่มี mask ที่ใช้ได้ทับแถวใน ROI ถึง 10%' : 'ไม่ผ่านขอบเขตการวิเคราะห์'} · ยังใช้ mask หรือกรอบสำรองตรวจการบังได้ ไม่ได้แปลว่าไม่มีรถ</p>}
      {info.status === 'NO_ANALYSIS' && <p>ยังไม่มีผลวิเคราะห์แถวสำหรับภาพนี้ จึงบอกแถวไม่ได้</p>}
      {info.status === 'NO_RECORD' && <p>ไม่พบรายการเชื่อมรถคันนี้กับกรอบบนแผนที่ในผลที่ได้รับ จึงยังระบุสาเหตุไม่ได้ กรุณาวิเคราะห์ใหม่แล้วตรวจ ID นี้อีกครั้ง</p>}
      {(layer?.row_assignment_distance_m ?? assignment?.distance_m) != null && <p>ระยะที่ระบบรายงานจากจุดถึงเส้น/ขอบแถว: {((layer?.row_assignment_distance_m ?? assignment?.distance_m ?? 0)*100).toFixed(1)} ซม.</p>}
      {(gaps?.occupancy_scope === 'IMAGE_NEAREST_LOWER_EDGE' || gaps?.occupancy_scope === 'IMAGE_ROW_POINT_OR_MASK') && <p className="text-xs text-slate-600">ระยะถึงเส้นเป็นข้อมูลประกอบ ไม่ใช้เป็นเกณฑ์ตัดรถออกจากแถวในโหมดนี้</p>}
      {assignment?.nearest_row_id && assignment.distance_line_metric?.length === 2 && <p className="text-pink-800">เส้นที่ใช้วัด: <strong>{assignment.nearest_row_id}</strong> · กากบาทชมพู = ศูนย์กลางจุดล่าง · จุดขาว = ปลายระยะบนเส้นแถว · แสดงเส้นเดียวกันบนภาพและแผนที่ เป็นแถวที่ใกล้ที่สุด ไม่ใช่การยืนยันแถวเจ้าของ</p>}
      {assignment?.ground_point && <p>พิกัดบนแผนที่จาก calibration: x {assignment.ground_point.x_m.toFixed(2)}, y {assignment.ground_point.y_m.toFixed(2)} ม. (ค่าประมาณจากจุดในภาพ)</p>}
      {layer && <p>{info.redBandVisible ? 'มีพื้นที่อ้างอิงสีแดงบนแผนที่ · กรอบสีส้มแสดงรถที่เลือก' : 'ไม่มีพื้นที่แดงภายในแถว/ROI จากกรอบอ้างอิงของคันนี้ แม้ Seg ตรวจพบ'}</p>}
      {layer && gaps?.uncertain_reference_ids.includes(info.id) && <p className="text-amber-800">ตำแหน่งรถคันนี้ยังมีความไม่แน่นอน</p>}
      <button type="button" className="rounded border px-3 py-1" onClick={onClose}>ปิดรายละเอียดรถ</button>
    </div>}
  </section>;
}
