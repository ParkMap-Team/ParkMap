"use client";

import { useState } from 'react';
import type { components } from '@/types/api.gen';
import { SegmentationTopDown } from './SegmentationTopDown';
import { gapPresentation } from '@/lib/segmentationGapPresentation';

type Result = components['schemas']['SegmentationExperimentResult'];

export function SegmentationExperiment({ result, error, gaps, standardCount, standardMs }: {
  result: Result | null; error: string; gaps?: components['schemas']['SegmentationGapResult'] | null; standardCount: number; standardMs?: number;
}) {
  const [chosenGap, setChosenGap] = useState('');
  const [chosenIncoming, setChosenIncoming] = useState('');
  const [showRows, setShowRows] = useState(true);
  const currentGap = gaps?.candidates.find(item => item.id === chosenGap) ?? gaps?.candidates.find(item => item.state === 'FIT' || item.state === 'SLOT_CLEAR') ?? gaps?.candidates[0];
  const fullFit = gaps?.evaluation_mode === 'FULL_FOOTPRINT';
  const slots = gaps?.evaluation_mode === 'VIRTUAL_SLOTS';
  const incomingSelected = gaps?.incoming_vehicle?.candidates.find(item => item.id === chosenIncoming && item.state === 'SLOT_CLEAR') ?? gaps?.incoming_vehicle?.candidates.find(item => item.state === 'SLOT_CLEAR');
  const reasons: Record<string, string> = {
    WIDTH_BELOW_TARGET: 'ช่องแคบกว่าเกณฑ์ความกว้างรถเป้าหมาย',
    GROUND_MAY_BE_OCCLUDED: 'พื้นอาจถูกตัวรถบัง', ROW_UNCERTAIN: 'แถวยังไม่แน่นอน',
    FOOTPRINT_NOT_PROVEN: 'ยังยืนยันการวาง footprint ไม่ได้', FULL_DEPTH_CORRIDOR_NOT_PROVEN: 'ช่องไม่ผ่านเงื่อนไขตลอดความลึก',
    PROJECTION_OUTSIDE_VALID_IMAGE: 'ฉายตำแหน่งออกนอกภาพ', NO_SEGMENTATION_EVIDENCE_IN_ROI: 'ยังไม่มีหลักฐานรถจาก segmentation ใน ROI',
    CURRENT_MATCHING_CALIBRATION_REQUIRED: 'ต้องมี calibration ที่ผ่านการตรวจและตรงกับภาพ/ROI ปัจจุบัน',
    SEGMENTATION_UNAVAILABLE: 'segmentation ยังใช้งานไม่ได้', INVALID_IMAGE_PROJECTION: 'การฉายตำแหน่งไม่ถูกต้อง',
  };
  const masks = result?.detections.filter(item => item.polygon).length ?? 0;
  return <section aria-label="Segmentation experiment" className="overflow-hidden rounded-2xl border border-cyan-300 bg-white">
    <div className="border-b p-4"><h2 className="font-semibold">YOLO11m-seg · ทดลอง polygon</h2>
      <p className="mt-1 text-sm text-slate-600">โมเดลเดิม: {standardCount} คัน{standardMs != null ? ` · ${(standardMs / 1000).toFixed(2)} วินาที` : ''}</p>
      {result && <p className="mt-1 text-sm text-cyan-900">Segmentation: {result.detections.length} คัน · {masks} polygon · {(result.processing_time_ms / 1000).toFixed(2)} วินาที · imgsz {result.imgsz}</p>}
      <p className="mt-2 text-xs text-amber-800">Mask เป็นขอบรถในภาพ ไม่ใช่ footprint บนพื้น ผลทดลองนี้ไม่เปลี่ยนผลมาตรฐานหรือ LIFF และแต่ละโมเดลอาจพบรถคนละคัน</p>
    </div>
    {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
    {!result && !error && <p className="p-4 text-sm text-slate-600">กด Analyze เพื่อเปรียบเทียบกับโมเดลเดิม</p>}
    {gaps && gaps.rows.length > 0 && <label className="flex items-center gap-2 px-4 py-2 text-sm text-purple-800"><input type="checkbox" aria-label="แสดงกรอบ row" checked={showRows} onChange={event => setShowRows(event.target.checked)} />แสดงกรอบแถว (row) สีม่วง · อิงแถวที่ใช้คำนวณช่องว่าง</label>}
    {result?.preview_url && <div className="relative"><img src={result.preview_url} alt="Segmentation comparison" className="block w-full" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Motorcycle segmentation polygons">
        {result.detections.map((item, index) => <g key={index}>{item.polygon ? <polygon points={item.polygon.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(6,182,212,.22)" stroke="#06b6d4" strokeWidth=".002"><title>Seg {index + 1} · {(item.confidence * 100).toFixed(1)}%</title></polygon> : <rect x={item.bbox.x} y={item.bbox.y} width={item.bbox.width} height={item.bbox.height} fill="none" stroke="#f59e0b" strokeDasharray=".006 .004" strokeWidth=".002"><title>Seg {index + 1} · ไม่มี mask</title></rect>}</g>)}
      </svg>
      {gaps && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Segmentation free-space candidates">
        {gaps.candidates.map(item => item.polygon_image && <polygon key={item.id} data-state={item.state} role="button" tabIndex={0} aria-label={`ตำแหน่งทดลอง ${item.id} ${item.state}`} pointerEvents="all"
          points={item.polygon_image.map(p => `${p.x},${p.y}`).join(' ')} fill={gapPresentation[item.state].fill} fillOpacity=".35"
          stroke={gapPresentation[item.state].color} strokeWidth={item.id === currentGap?.id ? '.005' : '.003'}
          onClick={() => setChosenGap(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosenGap(item.id); } }}><title>{item.id} · {item.state} · {item.gap_width_m.toFixed(2)} ม.</title></polygon>)}
        {currentGap?.width_line_image?.length === 2 && <line x1={currentGap.width_line_image[0].x} y1={currentGap.width_line_image[0].y} x2={currentGap.width_line_image[1].x} y2={currentGap.width_line_image[1].y} stroke={gapPresentation[currentGap.state].color} strokeWidth=".003" />}
        {currentGap?.nearest_line_image?.length === 2 && <line x1={currentGap.nearest_line_image[0].x} y1={currentGap.nearest_line_image[0].y} x2={currentGap.nearest_line_image[1].x} y2={currentGap.nearest_line_image[1].y} stroke="#f97316" strokeWidth=".003" />}
        {currentGap?.label_image && <text x={currentGap.label_image.x} y={currentGap.label_image.y} fontSize=".022" textAnchor="middle" fill="white" stroke="#0f172a" strokeWidth=".001" paintOrder="stroke">{currentGap.gap_width_m.toFixed(2)} ม.</text>}
        {incomingSelected?.polygon_image && <polygon data-incoming-id={incomingSelected.id} points={incomingSelected.polygon_image.map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(6,182,212,.25)" stroke="#0891b2" strokeWidth=".006" />}
      </svg>}
      {gaps && showRows && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Segmentation analysis row outlines">
        {gaps.rows.map(row => row.polygon_image && <g key={row.row_id} data-row-id={row.row_id}>
          <polygon points={row.polygon_image.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#a855f7" strokeWidth=".004"><title>ขอบเขตวิเคราะห์ {row.row_id}</title></polygon>
          {row.label_image && <text x={row.label_image.x} y={row.label_image.y} fontSize=".025" fontWeight="700" textAnchor="middle" fill="white" stroke="#7e22ce" strokeWidth=".003" paintOrder="stroke">{row.row_id}</text>}
        </g>)}
      </svg>}
    </div>}
    {gaps && <SegmentationTopDown gaps={gaps} selectedId={currentGap?.id} onSelect={setChosenGap} incomingSelectedId={incomingSelected?.id} onSelectIncoming={setChosenIncoming} />}
    {gaps && <section aria-label="ผลหาช่องว่าง segmentation" data-status={gaps.status} data-evaluation-mode={gaps.evaluation_mode} data-green-count={gaps.green_count} className="space-y-3 border-t p-4 text-sm">
      <h3 className="font-semibold">{slots ? 'ช่องจอดจำลอง · ลึกตามแถว' : fullFit ? 'ค้นหาพื้นที่วางรถทั้งคัน' : 'ตรวจเฉพาะความกว้าง'} · กว้าง {gaps.target_width_m.toFixed(2)}{fullFit ? ` × ${(gaps.target_length_m ?? 0).toFixed(2)}` : ''} ม.</h3>
      <p>สีเขียว{slots ? 'ช่องจำลองผ่านเกณฑ์' : fullFit ? 'วางกรอบรถได้' : 'กว้างพอ'}: {gaps.green_count} {slots ? 'ช่อง' : fullFit ? 'ตำแหน่งทดลอง' : 'ช่วงว่าง'} · สีเทายังยืนยันไม่ได้: {gaps.unknown_count}</p>
      <p className="font-medium text-amber-900">{slots ? 'แบ่งช่องกว้าง 1 ม. โดยใช้ความลึกของแต่ละแถว ตรวจสิ่งกีดขวางและการบังแยกทีละช่อง เศษที่ไม่ถึง 1 ม. ไม่เพิ่มเป็นช่อง · ยังไม่ตรวจความยาวของรุ่นรถหรือทางเข้า–ออก' : fullFit ? 'ตรวจกรอบรถทั้งคันในแถวและ ROI ไม่ทับรถเดิม และตรวจการบัง · ยังไม่ตรวจทางเข้า–ออก ไม่มีระยะเผื่อเพิ่ม' : 'ไม่ตรวจความยาวรถ สีเขียวหมายถึงกว้างพอเท่านั้น'}</p>
      <p className="text-amber-900">{gaps.calibration_source === 'ESTIMATED' ? 'ระยะประมาณจาก calibration แบบประมาณ' : gaps.calibration_source === 'MEASURED' ? 'ระยะคำนวณจาก calibration ที่ระบุว่าวัดจริง' : 'ยังไม่ยืนยันสเกลเมตร'} · ขนาด/ตำแหน่งรถเป็นค่าอ้างอิง ไม่ใช่การรับรองว่าจอดได้จริง · ไม่มีระยะเผื่อเพิ่มจาก footprint มาตรฐาน</p>
      {gaps.reasons.length > 0 && <p role="status" className="text-amber-800">{gaps.reasons.map(reason => reasons[reason] ?? reason).join(' · ')}</p>}
      <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">{gaps.candidates.map(item => <button type="button" key={item.id} onClick={() => setChosenGap(item.id)} aria-pressed={item.id === currentGap?.id} className="rounded border px-2 py-1" style={{ borderColor: gapPresentation[item.state].color, color: gapPresentation[item.state].color }}>{item.id} · {gapPresentation[item.state].label}</button>)}</div>
      {currentGap && <div aria-label="ระยะช่องว่างที่เลือก" className="rounded bg-slate-50 p-3">
        <p>{slots ? 'ขนาดช่องจำลอง' : 'ความกว้างช่องด้านข้าง'}: <strong>{currentGap.gap_width_m.toFixed(2)}{currentGap.slot_length_m != null ? ` × ${currentGap.slot_length_m.toFixed(2)}` : ''} ม.</strong></p>
        {currentGap.source_gap_width_m != null && <p>แบ่งจากช่วงว่าง {currentGap.source_gap_width_m.toFixed(2)} ม.</p>}
        <p>{currentGap.state === 'SLOT_CLEAR' ? 'ช่องจำลองผ่านเกณฑ์ ไม่ทับรถอ้างอิง · ยังไม่ตรวจความยาวรถรายรุ่นและทางเข้า–ออก' : currentGap.state === 'FIT' ? 'วางกรอบรถได้ตามแบบจำลอง · ยังไม่ตรวจทางเข้า–ออก' : currentGap.state === 'WIDTH_SUFFICIENT' ? 'ความกว้างเพียงพอ ยังไม่ตรวจความยาวรถ' : currentGap.reasons.map(reason => reasons[reason] ?? reason).join(' · ')}</p>
      </div>}
      {gaps.rows.map(row => <p key={row.row_id} className={row.state === 'NO_FIT' ? 'text-red-700' : 'text-slate-600'}>{row.row_id}: {row.state === 'NO_FIT' ? 'ยังไม่พบตำแหน่งที่ผ่านเกณฑ์' : `${row.fit_count} ${slots ? 'ช่องจำลองผ่านเกณฑ์' : fullFit ? 'ตำแหน่งวางกรอบรถได้' : 'ช่วงกว้างพอ'} · ${row.unknown_count} ยังยืนยันไม่ได้`}</p>)}
      {gaps.measured_gaps.length > 0 && <details><summary className="cursor-pointer font-semibold">ระยะช่วงว่างแต่ละแถว รวมช่องแคบ</summary>
        <p className="mt-2 text-xs text-slate-600">{slots ? 'ช่วงว่างระหว่างรถอ้างอิงตลอดความลึกแถว นำไปแบ่งเป็นช่องกว้าง 1 ม. เศษความกว้างไม่สร้างช่องเพิ่ม' : fullFit ? 'ระยะเบื้องต้นที่แนวหน้าแถว ใช้อธิบายช่องแคบ/สั้นเท่านั้น' : 'ระยะช่องด้านข้างที่กึ่งกลางแถว ไม่ตรวจความยาวรถ'}</p>
        <ul className="mt-2 max-h-44 space-y-1 overflow-auto">{gaps.measured_gaps.map((item, index) => <li key={index} className={item.state === 'REQUIRES_FIT_VALIDATION' ? 'text-amber-800' : 'text-red-700'}>{item.row_id} · กว้าง {item.width_m.toFixed(2)} ม. · ลึกที่ตรวจ {item.depth_m.toFixed(2)} ม. · {item.state === 'INSUFFICIENT_WIDTH' ? 'กว้างไม่พอ' : item.state === 'INSUFFICIENT_DEPTH' ? 'ลึกไม่พอ' : 'ต้องตรวจ FIT/ความไม่แน่นอน'}</li>)}</ul>
      </details>}
      {gaps.truncated && <p>แสดงข้อมูลไม่เกิน 200 รายการต่อชนิด</p>}
    </section>}
    {result && <p className="p-3 text-xs text-slate-600">สีฟ้า = mask รถ · กรอบประสีเหลือง = ตรวจพบแต่ไม่มี mask · เวลารอบแรกอาจรวมการโหลดโมเดล การไม่พบรถไม่ยืนยันว่าพื้นที่ว่าง</p>}
  </section>;
}
