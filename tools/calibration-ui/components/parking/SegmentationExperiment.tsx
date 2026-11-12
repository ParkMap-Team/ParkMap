"use client";

import { useState } from 'react';
import type { components } from '@/types/api.gen';
import { imageGapPath } from '@/lib/gapGeometry';
import { SegmentationTopDown } from './SegmentationTopDown';
import { SegDetectionHitTargets, SegDetectionInspector } from './SegDetectionInspector';
import { HorizontalVehicleImageOverlay } from './HorizontalVehiclePreview';
import { RowDistanceImageOverlay } from './RowDistanceOverlay';
import { GapNearFitAdvice } from './GapNearFitAdvice';
import { GapOcclusionInspector, GapOcclusionOverlay } from './GapOcclusionInspector';
import { OrientationImageOverlay } from './GapOrientationPreview';
import { gapPresentation, gapReasonLabels, isWidthPreview, widthPreviewLabel } from '@/lib/segmentationGapPresentation';

type Result = components['schemas']['SegmentationExperimentResult'];
type Gaps = components['schemas']['SegmentationGapResult'];
type Background = components['schemas']['GapBackgroundRegion'];

export function SegmentationExperiment({ result, error, gaps, standardCount = 0, standardMs, primary = false }: {
  result: Result | null; error: string; gaps?: components['schemas']['SegmentationGapResult'] | null; standardCount?: number; standardMs?: number; primary?: boolean;
}) {
  const [chosenGap, setChosenGap] = useState('');
  const [chosenIncoming, setChosenIncoming] = useState('');
  const [chosenDetection, setChosenDetection] = useState<{ result: Result; index: number } | null>(null);
  const [showRows, setShowRows] = useState(true);
  const [previewWidthOnly, setPreviewWidthOnly] = useState(true);
  const [showOcclusion, setShowOcclusion] = useState(true);
  const [showOrientation, setShowOrientation] = useState(false);
  const [showHorizontal, setShowHorizontal] = useState(true);
  const [chosenHorizontal, setChosenHorizontal] = useState<{ result: Gaps; id: string } | null>(null);
  const [chosenOrientation, setChosenOrientation] = useState('');
  const [inspectedBackground, setInspectedBackground] = useState<{ result: Gaps; region: Background } | null>(null);
  const currentGap = gaps?.candidates.find(item => item.id === chosenGap) ?? gaps?.candidates.find(item => item.state === 'FIT' || item.state === 'SLOT_CLEAR' || item.state === 'WIDTH_SUFFICIENT') ?? gaps?.candidates.find(item => item.state === 'ALMOST_AVAILABLE') ?? gaps?.candidates[0];
  const fullFit = gaps?.evaluation_mode === 'FULL_FOOTPRINT';
  const slots = gaps?.evaluation_mode === 'VIRTUAL_SLOTS';
  const continuous = gaps?.evaluation_mode === 'CONTINUOUS_GAPS';
  const shapes = gaps?.evaluation_mode === 'VISIBLE_FREE_SHAPES';
  const incomingSelected = gaps?.incoming_vehicle?.candidates.find(item => item.id === chosenIncoming && (item.state === 'SLOT_CLEAR' || item.state === 'WIDTH_SUFFICIENT')) ?? gaps?.incoming_vehicle?.candidates.find(item => item.state === 'SLOT_CLEAR' || item.state === 'WIDTH_SUFFICIENT');
  const background = inspectedBackground && inspectedBackground.result === gaps ? inspectedBackground.region : undefined;
  const inspection = background ?? currentGap;
  const selectBackground = (region?: Background) => setInspectedBackground(region && gaps ? { result: gaps, region } : null);
  const selectGap = (id: string) => { setInspectedBackground(null); setChosenGap(id); };
  const selectIncoming = (id: string) => { setInspectedBackground(null); setChosenIncoming(id); };
  const orientation = gaps?.orientation_hypotheses.find(item => item.detection_id === chosenOrientation) ?? gaps?.orientation_hypotheses.find(item => item.image_orientation === 'HORIZONTAL_IMAGE') ?? gaps?.orientation_hypotheses[0];
  const orientationControl = { enabled: showOrientation, selectedId: orientation?.detection_id, onToggle: setShowOrientation, onSelect: setChosenOrientation };
  const reasons: Record<string, string> = {
    ...gapReasonLabels,
    WIDTH_BELOW_TARGET: 'ช่องแคบกว่าเกณฑ์ความกว้างรถเป้าหมาย',
    GROUND_MAY_BE_OCCLUDED: 'พื้นอาจถูกตัวรถบัง', ROW_UNCERTAIN: 'แถวยังไม่แน่นอน',
    FOOTPRINT_NOT_PROVEN: 'ยังยืนยันการวาง footprint ไม่ได้', FULL_DEPTH_CORRIDOR_NOT_PROVEN: 'ช่องไม่ผ่านเงื่อนไขตลอดความลึก',
    PROJECTION_OUTSIDE_VALID_IMAGE: 'ฉายตำแหน่งออกนอกภาพ', NO_SEGMENTATION_EVIDENCE_IN_ROI: 'ยังไม่มีหลักฐานรถจาก segmentation ใน ROI',
    CURRENT_MATCHING_CALIBRATION_REQUIRED: 'ต้องมี calibration ที่ผ่านการตรวจและตรงกับภาพ/ROI ปัจจุบัน',
    SEGMENTATION_UNAVAILABLE: 'segmentation ยังใช้งานไม่ได้', INVALID_IMAGE_PROJECTION: 'การฉายตำแหน่งไม่ถูกต้อง',
  };
  const masks = result?.detections.filter(item => item.polygon).length ?? 0;
  const modelName = result?.model ?? 'Segmentation';
  const selectedDetectionIndex = chosenDetection?.result === result ? chosenDetection?.index : undefined;
  const distanceAssignment = selectedDetectionIndex == null ? undefined : gaps?.detection_row_assignments?.find(item => item.detection_id === `detection_${selectedDetectionIndex+1}`);
  const horizontalVehicles = gaps?.horizontal_vehicles ?? [];
  const selectedHorizontal = (chosenHorizontal?.result === gaps ? horizontalVehicles.find(item => item.detection_id === chosenHorizontal?.id) : undefined)
    ?? horizontalVehicles.find(item => item.clearance_m != null && item.clearance_m > 0)
    ?? horizontalVehicles.find(item => item.measurement_status === 'APPROXIMATE_REFERENCE') ?? horizontalVehicles[0];
  const selectHorizontal = (id: string) => {
    if (!gaps) return;
    setChosenHorizontal({ result: gaps, id });
    const item = horizontalVehicles.find(vehicle => vehicle.detection_id === id);
    if (result && item) setChosenDetection({ result, index: item.detection_index });
  };
  const horizontalControl = { enabled: showHorizontal, selectedId: selectedHorizontal?.detection_id, onToggle: setShowHorizontal, onSelect: selectHorizontal };
  const selectDetection = (index: number) => {
    if (result) setChosenDetection({ result, index });
    if (gaps && horizontalVehicles.some(item => item.detection_index === index)) setChosenHorizontal({ result: gaps, id: `detection_${index+1}` });
  };
  return <section aria-label="Segmentation experiment" className="overflow-hidden rounded-2xl border border-cyan-300 bg-white">
    <div className="border-b p-4"><h2 className="font-semibold">{modelName} · {primary ? 'ตรวจจับรถและหาช่องว่าง' : 'ทดลอง polygon'}</h2>
      {!primary && <p className="mt-1 text-sm text-slate-600">โมเดลเดิม: {standardCount} คัน{standardMs != null ? ` · ${(standardMs / 1000).toFixed(2)} วินาที` : ''}</p>}
      {result && <p className="mt-1 text-sm text-cyan-900">Segmentation: {result.detections.length} คัน · {masks} polygon · {(result.processing_time_ms / 1000).toFixed(2)} วินาที · imgsz {result.imgsz}</p>}
      <p className="mt-2 text-xs text-amber-800">Mask เป็นขอบรถในภาพ ไม่ใช่ footprint บนพื้น · ผลบนหน้า Parking นี้ไม่เปลี่ยน LIFF/worker</p>
      {gaps?.occupancy_source === 'SEGMENTATION_ONLY' && <p className="mt-2 text-sm font-medium text-cyan-900">ผลหาช่วงว่างด้านล่างใช้เฉพาะ {modelName} ไม่รวมรถจากโมเดลเดิม · ใช้ mask ตรวจการบัง และใช้กรอบสำรองเมื่อ mask ใช้ไม่ได้</p>}
      {gaps?.occupancy_scope === 'GROUND_ANCHOR_OR_ROW_MASK' && <p data-occupancy-scope={gaps.occupancy_scope} className="mt-2 text-xs text-slate-600">คงรถที่จุดอ้างอิงอยู่ในแถว หรือมี mask ทับแถวภายใน ROI แม้จุดล่างกรอบเลยขอบเล็กน้อย · ตัดกรอบอ้างอิงรถที่ไม่มีหลักฐานในแถว {gaps.excluded_detection_ids.length} คัน · mask ทุกคันยังใช้ตรวจการบังตามภาพจริง</p>}
      {gaps?.occupancy_scope === 'BOTTOM_EDGE_ANCHOR' && <p data-occupancy-scope={gaps.occupancy_scope} className="mt-2 text-xs text-slate-600">ใช้จุดกึ่งกลางล่างเลือกเส้นล่างแถวที่ใกล้ที่สุด · รถหนึ่งคันกันพื้นที่เพียงแถวเดียว กว้างตามค่าอ้างอิงเดิม ลึกตามแถว · {gaps.excluded_detection_ids.length} คันยังไม่ผ่านเกณฑ์ กดรถเพื่อดูเหตุผล · mask ไม่ใช้เลือกแถว แต่ยังใช้ตรวจการบัง</p>}
      {gaps?.occupancy_scope === 'IMAGE_NEAREST_LOWER_EDGE' && <p data-occupancy-scope={gaps.occupancy_scope} className="mt-2 text-sm font-medium text-cyan-900">เลือกแถวจากเส้นล่างบนภาพที่ใกล้จุดกึ่งกลางล่างของรถที่สุด · จุดต้องอยู่ในช่วงความกว้างเส้น · ไม่ใช้เกณฑ์ 20 ซม. · ใกล้สองเส้นพอ ๆ กันยังไม่เลือก · จุดเลย ROI เกิน 40 ซม. ไม่นับ · รถหนึ่งคันกันพื้นที่แถวเดียว</p>}
      {gaps?.occupancy_scope === 'IMAGE_ROW_POINT_OR_MASK' && <p data-occupancy-scope={gaps.occupancy_scope} className="mt-2 text-sm font-medium text-cyan-900">จุดกึ่งกลางล่างอยู่ในกรอบแถวบนภาพ → จัดเข้าแถวนั้น โดยไม่ใช้ระยะ 20/40 ซม. ตัดรถออก · ถ้าจุดอยู่นอกแถว ใช้ mask ที่ผ่านการตรวจช่วยเลือกแถวเดียว · รถหนึ่งคันกันพื้นที่อ้างอิงแถวเดียว กว้างตามค่าเดิมและลึกตามแถว</p>}
      {gaps?.row_owned_references && <p className="mt-2 text-xs text-cyan-900">รถที่ระบุแถวได้จะกันพื้นที่เฉพาะแถวของตัวเอง · รถที่แยกแถวไม่ได้ยังคงความไม่แน่นอน และยังตรวจการบังจริงจาก mask ทุกคัน</p>}
      {gaps?.row_owned_references && gaps.occupancy_scope !== 'IMAGE_ROW_POINT_OR_MASK' && gaps.occupancy_scope !== 'IMAGE_NEAREST_LOWER_EDGE' && <p className="mt-2 text-xs text-cyan-900">เลือกแถวจากจุดกึ่งกลางล่างถึงเส้นล่างสีฟ้าอมเขียว · ปกติไม่เกิน 20 ซม. หากมี mask ที่ใช้ได้ทับแถวช่วยยืนยันและจุดอยู่ในแถวนั้น รับได้ถึงครึ่งความลึกแถว · ต้องใกล้กว่าเส้นรองอย่างน้อย 10 ซม. และอยู่ในช่วงความกว้าง/ROI · รถหนึ่งคันกันพื้นที่แถวเดียว ยังเป็นค่าประมาณ</p>}
      {gaps?.row_owned_references && gaps.occupancy_scope !== 'IMAGE_ROW_POINT_OR_MASK' && gaps.occupancy_scope !== 'IMAGE_NEAREST_LOWER_EDGE' && <p className="mt-1 text-xs text-amber-900">ข้อยกเว้นทดลอง: จุดล่างเลย ROI ได้ไม่เกิน 40 ซม. เมื่อมี mask ที่ใช้ได้ทับแถวที่ใกล้ที่สุดอย่างน้อย 10% และห่างเส้นล่างไม่เกิน 40 ซม. · พื้นที่แดงยังอยู่ในแถวเดียวและ ROI เดิม</p>}
      {gaps?.occupied_layers.some(layer => layer.row_assignment_source === 'BOTTOM_EDGE_APPROXIMATE') && <details className="mt-2 text-xs text-cyan-900"><summary className="cursor-pointer">รถที่จัดตามเส้นล่างของแถว</summary><ul>{gaps.occupied_layers.filter(layer => layer.row_assignment_source === 'BOTTOM_EDGE_APPROXIMATE').map(layer => <li key={layer.detection_id}>{layer.detection_id} → {layer.assigned_row_id} · ห่างเส้นล่าง {((layer.row_assignment_distance_m ?? 0)*100).toFixed(1)} ซม. · ค่าประมาณ</li>)}</ul></details>}
      {gaps?.occupied_layers.some(layer => layer.row_assignment_source === 'NEAREST_APPROXIMATE') && <details className="mt-2 text-xs text-amber-900"><summary className="cursor-pointer">รถที่จับเข้าแถวใกล้ที่สุดแบบประมาณ</summary><ul>{gaps.occupied_layers.filter(layer => layer.row_assignment_source === 'NEAREST_APPROXIMATE').map(layer => <li key={layer.detection_id}>{layer.detection_id} → {layer.assigned_row_id} · ห่างขอบ {((layer.row_assignment_distance_m ?? 0)*100).toFixed(1)} ซม. · ยังไม่ยืนยันตำแหน่งจริง</li>)}</ul></details>}
      {!!gaps?.uncertain_reference_ids.length && <p className="mt-2 text-xs text-amber-900">คงกรอบรถที่ตำแหน่งยังไม่แน่นอน {gaps.uncertain_reference_ids.length} คันไว้ในผล ไม่ถือว่าเป็นพื้นที่ว่าง · mask ใช้ตรวจการบัง ไม่ใช้เลือกแถว</p>}
    </div>
    {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
    {!result && !error && <p className="p-4 text-sm text-slate-600">{primary ? 'เลือกรูปหรือวิดีโอ แล้วกด Analyze เพื่อตรวจจับรถและหาช่องว่าง' : 'กด Analyze เพื่อเปรียบเทียบกับโมเดลเดิม'}</p>}
    {gaps && gaps.rows.length > 0 && <label className="flex items-center gap-2 px-4 py-2 text-sm text-purple-800"><input type="checkbox" aria-label="แสดงกรอบ row" checked={showRows} onChange={event => setShowRows(event.target.checked)} />แสดงกรอบแถว (row) สีม่วง · อิงแถวที่ใช้คำนวณช่องว่าง</label>}
    {result && <p className="px-4 py-2 text-sm text-orange-900">กดรถบนภาพเพื่อตรวจว่าอยู่แถวไหน หรือถูกกรองออกจากแผนที่หรือไม่ · รถที่เลือกจะแสดงกรอบสีส้ม</p>}
    {result?.preview_url && <div className="relative"><img src={result.preview_url} alt="Segmentation comparison" className="block w-full" />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Motorcycle segmentation polygons">
        {result.detections.map((item, index) => <g key={index}>{item.polygon ? <polygon points={item.polygon.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(6,182,212,.22)" stroke="#06b6d4" strokeWidth=".002"><title>Seg {index + 1} · {(item.confidence * 100).toFixed(1)}%</title></polygon> : <rect x={item.bbox.x} y={item.bbox.y} width={item.bbox.width} height={item.bbox.height} fill="none" stroke="#f59e0b" strokeDasharray=".006 .004" strokeWidth=".002"><title>Seg {index + 1} · ไม่มี mask</title></rect>}</g>)}
        {result.detections.map((item, index) => <circle key={`anchor-${index}`} data-ground-anchor={`detection_${index+1}`} cx={item.bbox.x+item.bbox.width/2} cy={item.bbox.y+item.bbox.height} r=".003" fill="#facc15" stroke="#0f172a" strokeWidth=".001"><title>จุดกึ่งกลางล่าง · detection_{index+1} · {gaps?.occupied_layers.find(layer => layer.detection_index === index)?.assigned_row_id ?? 'ยังระบุแถวไม่ได้'}</title></circle>)}
      </svg>
      {gaps && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Segmentation free-space candidates">
        {gaps.candidates.map(item => imageGapPath(item) && <path key={item.id} data-state={item.state} role="button" tabIndex={0} aria-label={`ตำแหน่งทดลอง ${item.id} ${item.state}`} pointerEvents="all"
          data-width-preview={isWidthPreview(item, previewWidthOnly)} d={imageGapPath(item)} fillRule="evenodd" fill={isWidthPreview(item, previewWidthOnly) ? '#4ade80' : gapPresentation[item.state].fill} fillOpacity={isWidthPreview(item, previewWidthOnly) ? .7 : .35}
          stroke={gapPresentation[item.state].color} strokeWidth={item.id === currentGap?.id ? '.005' : '.003'}
          onClick={() => selectGap(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectGap(item.id); } }}><title>{item.id} · {item.state} · {item.gap_width_m.toFixed(2)} ม.{isWidthPreview(item, previewWidthOnly) ? ` · ${widthPreviewLabel}` : ''}</title></path>)}
        {currentGap?.width_line_image?.length === 2 && <line x1={currentGap.width_line_image[0].x} y1={currentGap.width_line_image[0].y} x2={currentGap.width_line_image[1].x} y2={currentGap.width_line_image[1].y} stroke={gapPresentation[currentGap.state].color} strokeWidth=".003" />}
        {currentGap?.near_fit && <polygon data-advisory-target={currentGap.id} points={currentGap.near_fit.target_polygon_image.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#a16207" strokeDasharray=".006 .004" strokeWidth=".003" />}
        {currentGap?.nearest_line_image?.length === 2 && <line x1={currentGap.nearest_line_image[0].x} y1={currentGap.nearest_line_image[0].y} x2={currentGap.nearest_line_image[1].x} y2={currentGap.nearest_line_image[1].y} stroke="#f97316" strokeWidth=".003" />}
        {currentGap?.label_image && <text x={currentGap.label_image.x} y={currentGap.label_image.y} fontSize=".022" textAnchor="middle" fill="white" stroke="#0f172a" strokeWidth=".001" paintOrder="stroke">{currentGap.gap_width_m.toFixed(2)} ม.</text>}
        {incomingSelected && imageGapPath(incomingSelected) && <path data-incoming-id={incomingSelected.id} d={imageGapPath(incomingSelected)} fillRule="evenodd" fill="rgba(6,182,212,.25)" stroke="#0891b2" strokeWidth=".006" />}
      </svg>}
      {gaps && showRows && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Segmentation analysis row outlines">
        {gaps.rows.map(row => row.polygon_image && <g key={row.row_id} data-row-id={row.row_id}>
          <polygon points={row.polygon_image.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#a855f7" strokeWidth=".004"><title>ขอบเขตวิเคราะห์ {row.row_id}</title></polygon>
          {row.bottom_edge_image?.length === 2 && <line data-row-bottom-edge={row.row_id} x1={row.bottom_edge_image[0].x} y1={row.bottom_edge_image[0].y} x2={row.bottom_edge_image[1].x} y2={row.bottom_edge_image[1].y} stroke="#0d9488" strokeWidth=".004"><title>เส้นล่างอ้างอิง {row.row_id}</title></line>}
          {row.label_image && <text x={row.label_image.x} y={row.label_image.y} fontSize=".025" fontWeight="700" textAnchor="middle" fill="white" stroke="#7e22ce" strokeWidth=".003" paintOrder="stroke">{row.row_id}</text>}
        </g>)}
      </svg>}
      {showOcclusion && inspection && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="ส่วนที่รถทับช่องในภาพ">
        <GapOcclusionOverlay gap={inspection} result={result} />
      </svg>}
      {showOrientation && gaps && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="ทดลองแนวรถบนภาพ">
        <OrientationImageOverlay hypotheses={gaps.orientation_hypotheses} control={orientationControl} />
      </svg>}
      <SegDetectionHitTargets result={result} selectedIndex={selectedDetectionIndex} onSelect={selectDetection} />
      {showHorizontal && horizontalVehicles.length > 0 && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="รถแนวนอนและระยะอ้างอิงบนภาพ">
        <HorizontalVehicleImageOverlay vehicles={horizontalVehicles} control={horizontalControl} />
      </svg>}
      {distanceAssignment && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="เส้นระยะจากจุดล่างรถถึงแถว">
        <RowDistanceImageOverlay assignment={distanceAssignment} />
      </svg>}
    </div>}
    {result && <SegDetectionInspector result={result} gaps={gaps} selectedIndex={selectedDetectionIndex} onSelect={selectDetection} onClose={() => setChosenDetection(null)} />}
    {gaps && <SegmentationTopDown gaps={gaps} selectedId={currentGap?.id} onSelect={selectGap} incomingSelectedId={incomingSelected?.id} onSelectIncoming={selectIncoming} previewWidthOnly={previewWidthOnly} onPreviewWidthOnly={setPreviewWidthOnly}
      modelName={modelName}
      horizontalPreview={horizontalControl}
      inspectedDetectionId={selectedDetectionIndex == null ? undefined : `detection_${selectedDetectionIndex+1}`}
      backgroundId={background?.id} onInspectBackground={selectBackground}
      orientationPreview={orientationControl}
      occlusionInspector={result && inspection ? <GapOcclusionInspector gap={inspection} result={result} showOverlay={showOcclusion} onShowOverlay={setShowOcclusion} /> : null} />}
    {gaps && <section aria-label="ผลหาช่องว่าง segmentation" data-status={gaps.status} data-evaluation-mode={gaps.evaluation_mode} data-green-count={gaps.green_count} data-almost-count={gaps.almost_count} className="space-y-3 border-t p-4 text-sm">
      {shapes && <p className="font-medium text-cyan-900">ประเมินพื้นที่ว่างตามรูปทรงที่เหลือ · เกณฑ์กว้าง {gaps.target_width_m.toFixed(2)} + เผื่อรวม {gaps.clearance_margin_m.toFixed(2)} ม. · สีเขียวมีแนววัดภายในที่กว้างพอ ยังไม่ตรวจความยาวรถหรือทางเข้า–ออก</p>}
      <h3 className="font-semibold">{continuous ? 'ช่วงว่างต่อเนื่อง · ลึกตามแถว' : slots ? 'ช่องจอดจำลอง · ลึกตามแถว' : fullFit ? 'ค้นหาพื้นที่วางรถทั้งคัน' : 'ตรวจเฉพาะความกว้าง'} · รถกว้าง {gaps.target_width_m.toFixed(2)}{fullFit ? ` × ${(gaps.target_length_m ?? 0).toFixed(2)}` : ''} ม.{continuous ? ` + เผื่อรวม ${gaps.clearance_margin_m.toFixed(2)} ม.` : ''}</h3>
      <p>สีเขียว{slots ? 'ช่องจำลองผ่านเกณฑ์' : fullFit ? 'วางกรอบรถได้' : 'กว้างพอ'}: {gaps.green_count} {slots ? 'ช่อง' : fullFit ? 'ตำแหน่งทดลอง' : 'ช่วงว่าง'} · สีเทายังยืนยันไม่ได้: {gaps.unknown_count}</p>
      {continuous && <p className="font-medium text-yellow-900">สีเหลือง อาจจอดได้หากขยับรถข้างเคียง: {gaps.almost_count} ช่วง · ขาดความกว้างไม่เกิน {(gaps.advisory_max_extra_width_m*100).toFixed(0)} ซม. และทับพื้นที่รถไม่เกิน {(gaps.advisory_max_overlap_ratio*100).toFixed(0)}% · ยังไม่ได้คำนวณแผนขยับรถ</p>}
      <p className="font-medium text-amber-900">{continuous ? 'แสดงทุกช่วงว่างเต็มความกว้าง ไม่แบ่งช่อง 1 ม. เทียบกับความกว้างรถ + ระยะเผื่อรวม · สีเขียวหมายถึงกว้างพอตามแบบจำลอง ยังไม่ตรวจความยาวรถหรือทางเข้า–ออก · กรอบรถยังใช้แนวอ้างอิง ไม่ได้หาแนวรถจริงอัตโนมัติ' : slots ? 'แบ่งช่องกว้าง 1 ม. โดยใช้ความลึกของแต่ละแถว ตรวจสิ่งกีดขวางและการบังแยกทีละช่อง เศษที่ไม่ถึง 1 ม. ไม่เพิ่มเป็นช่อง · ยังไม่ตรวจความยาวของรุ่นรถหรือทางเข้า–ออก' : fullFit ? 'ตรวจกรอบรถทั้งคันในแถวและ ROI ไม่ทับรถเดิม และตรวจการบัง · ยังไม่ตรวจทางเข้า–ออก ไม่มีระยะเผื่อเพิ่ม' : 'ไม่ตรวจความยาวรถ สีเขียวหมายถึงกว้างพอเท่านั้น'}</p>
      <p className="text-amber-900">{gaps.calibration_source === 'ESTIMATED' ? 'ระยะประมาณจาก calibration แบบประมาณ' : gaps.calibration_source === 'MEASURED' ? 'ระยะคำนวณจาก calibration ที่ระบุว่าวัดจริง' : 'ยังไม่ยืนยันสเกลเมตร'} · ขนาด/ตำแหน่งรถเป็นค่าอ้างอิง ไม่ใช่การรับรองว่าจอดได้จริง · ระยะเผื่อรวม {gaps.clearance_margin_m.toFixed(3)} ม.</p>
      {gaps.reasons.length > 0 && <p role="status" className="text-amber-800">{gaps.reasons.map(reason => reasons[reason] ?? reason).join(' · ')}</p>}
      <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">{gaps.candidates.map(item => <button type="button" key={item.id} onClick={() => selectGap(item.id)} aria-pressed={item.id === currentGap?.id} className="rounded border px-2 py-1" style={{ borderColor: gapPresentation[item.state].color, color: gapPresentation[item.state].color }}>{item.id} · {gapPresentation[item.state].label}</button>)}</div>
      {currentGap && <div aria-label="ระยะช่องว่างที่เลือก" className="rounded bg-slate-50 p-3">
        <p>{slots ? 'ขนาดช่องจำลอง' : 'ความกว้างช่องด้านข้าง'}: <strong>{currentGap.gap_width_m.toFixed(2)}{currentGap.slot_length_m != null ? ` × ${currentGap.slot_length_m.toFixed(2)}` : ''} ม.</strong></p>
        {currentGap.source_gap_width_m != null && <p>แบ่งจากช่วงว่าง {currentGap.source_gap_width_m.toFixed(2)} ม.</p>}
        {currentGap.depth_at_width_midpoint_m != null && <p>ลึกตรงกลางแนววัด {currentGap.depth_at_width_midpoint_m.toFixed(2)} ม. · ไม่ได้ยืนยันความลึกตลอดความกว้าง</p>}
        {currentGap.width_blocking_detection_ids.length > 0 && <p>รถที่เป็นขอบช่วงความกว้างนี้: {currentGap.width_blocking_detection_ids.join(', ')}</p>}
        <p>{currentGap.state === 'SLOT_CLEAR' ? 'ช่องจำลองผ่านเกณฑ์ ไม่ทับรถอ้างอิง · ยังไม่ตรวจความยาวรถรายรุ่นและทางเข้า–ออก' : currentGap.state === 'FIT' ? 'วางกรอบรถได้ตามแบบจำลอง · ยังไม่ตรวจทางเข้า–ออก' : currentGap.state === 'WIDTH_SUFFICIENT' ? 'ความกว้างเพียงพอ ยังไม่ตรวจความยาวรถ' : currentGap.reasons.map(reason => reasons[reason] ?? reason).join(' · ')}</p>
        <GapNearFitAdvice gap={currentGap} />
      </div>}
      {gaps.rows.map(row => <p key={row.row_id} className={row.state === 'NO_FIT' ? 'text-red-700' : 'text-slate-600'}>{row.row_id}: {row.state === 'NO_FIT' ? 'ยังไม่พบตำแหน่งที่ผ่านเกณฑ์' : `${row.fit_count} ${slots ? 'ช่องจำลองผ่านเกณฑ์' : fullFit ? 'ตำแหน่งวางกรอบรถได้' : 'ช่วงกว้างพอ'} · ${row.almost_count} สีเหลือง · ${row.unknown_count} ยังยืนยันไม่ได้`}</p>)}
      {gaps.measured_gaps.length > 0 && <details><summary className="cursor-pointer font-semibold">ระยะช่วงว่างแต่ละแถว รวมช่องแคบ</summary>
        <p className="mt-2 text-xs text-slate-600">{continuous ? 'ช่วงว่างระหว่างรถอ้างอิงตลอดความลึกแถว รวมช่วงที่แคบกว่าเกณฑ์รถและระยะเผื่อ ทุกช่วงแสดงบนแผนที่แล้ว' : slots ? 'ช่วงว่างระหว่างรถอ้างอิงตลอดความลึกแถว นำไปแบ่งเป็นช่องกว้าง 1 ม. เศษความกว้างไม่สร้างช่องเพิ่ม' : fullFit ? 'ระยะเบื้องต้นที่แนวหน้าแถว ใช้อธิบายช่องแคบ/สั้นเท่านั้น' : 'ระยะช่องด้านข้างที่กึ่งกลางแถว ไม่ตรวจความยาวรถ'}</p>
        <ul className="mt-2 max-h-44 space-y-1 overflow-auto">{gaps.measured_gaps.map((item, index) => <li key={index} className={item.state === 'REQUIRES_FIT_VALIDATION' ? 'text-amber-800' : 'text-red-700'}>{item.row_id} · กว้าง {item.width_m.toFixed(2)} ม. · ลึกที่ตรวจ {item.depth_m.toFixed(2)} ม. · {item.state === 'INSUFFICIENT_WIDTH' ? 'กว้างไม่พอ' : item.state === 'INSUFFICIENT_DEPTH' ? 'ลึกไม่พอ' : 'ต้องตรวจ FIT/ความไม่แน่นอน'}</li>)}</ul>
      </details>}
      {gaps.truncated && <p>แสดงข้อมูลไม่เกิน 200 รายการต่อชนิด</p>}
    </section>}
    {result && <p className="p-3 text-xs text-slate-600">สีฟ้า = mask รถ · กรอบประสีเหลือง = ตรวจพบแต่ไม่มี mask · เวลารอบแรกอาจรวมการโหลดโมเดล การไม่พบรถไม่ยืนยันว่าพื้นที่ว่าง</p>}
  </section>;
}
