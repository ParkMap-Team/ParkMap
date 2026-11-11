"use client";

import { useId, useState, type ReactNode } from 'react';
import type { components } from '@/types/api.gen';
import { metricGapPath } from '@/lib/gapGeometry';
import { unknownGapDisplay } from '@/lib/unknownGapDisplay';
import { gapPresentation, gapReasonLabels, isWidthPreview, widthPreviewLabel } from '@/lib/segmentationGapPresentation';
import { GapFamilyRecommendations } from './GapFamilyRecommendations';
import { IncomingVehicleRecommendations } from './IncomingVehicleRecommendations';
import { GapNearFitAdvice } from './GapNearFitAdvice';
import { HorizontalVehicleMetricOverlay, HorizontalVehiclePanel, type HorizontalVehicleControl } from './HorizontalVehiclePreview';
import { RowDistanceMetricOverlay } from './RowDistanceOverlay';
import { GapOrientationPreview, OrientationMetricOverlay, type OrientationPreviewControl } from './GapOrientationPreview';

type Gaps = components['schemas']['SegmentationGapResult'];
type Point = components['schemas']['MetricGroundPoint'];
const points = (ring: Point[]) => ring.map(p => `${p.x_m},${p.y_m}`).join(' ');
const path = (rings: Point[][]) => rings.map(ring => ring.length ? `M${ring.map(p => `${p.x_m},${p.y_m}`).join(' L')} Z` : '').join(' ');

export function SegmentationTopDown({ gaps, selectedId, onSelect, incomingSelectedId, onSelectIncoming, previewWidthOnly, onPreviewWidthOnly, occlusionInspector, backgroundId, onInspectBackground, orientationPreview, inspectedDetectionId, modelName = 'Segmentation', horizontalPreview }: {
  gaps: Gaps; selectedId?: string; onSelect: (id: string) => void;
  incomingSelectedId?: string; onSelectIncoming: (id: string) => void;
  previewWidthOnly: boolean; onPreviewWidthOnly: (enabled: boolean) => void;
  occlusionInspector?: ReactNode;
  backgroundId?: string; onInspectBackground: (region?: components['schemas']['GapBackgroundRegion']) => void;
  orientationPreview?: OrientationPreviewControl;
  inspectedDetectionId?: string;
  modelName?: string;
  horizontalPreview?: HorizontalVehicleControl;
}) {
  const [zoom, setZoom] = useState(1);
  const [showOutside, setShowOutside] = useState(false);
  const [detector, setDetector] = useState('SEGMENTATION');
  const clipId = useId();
  const rowClipId = useId();
  const widthPatternId = useId();
  const roi = gaps.parking_roi_metric;
  const fullFit = gaps.evaluation_mode === 'FULL_FOOTPRINT';
  const slots = gaps.evaluation_mode === 'VIRTUAL_SLOTS';
  const continuous = gaps.evaluation_mode === 'CONTINUOUS_GAPS';
  const shapes = gaps.evaluation_mode === 'VISIBLE_FREE_SHAPES';
  const rectangles = fullFit || slots || continuous || shapes;
  if (!roi?.polygons.length) return <p className="border-t p-4 text-sm text-amber-800">แผนผัง 2D ทดลองต้องมี calibration ที่ตรงกับภาพก่อน</p>;
  const segmentationOnly = gaps.occupancy_source === 'SEGMENTATION_ONLY';
  const layers = gaps.occupied_layers.filter(layer => segmentationOnly ? layer.source === 'SEGMENTATION' : detector === 'BOTH' || layer.source === detector);
  const visibleGeometry = layers.map(layer => ({ layer, geometry: showOutside ? layer.geometry : layer.row_depth_geometry ?? layer.roi_geometry }));
  const inspectedGeometry = visibleGeometry.find(item => item.layer.source === 'SEGMENTATION' && item.layer.detection_id === inspectedDetectionId);
  const distanceAssignment = gaps.detection_row_assignments?.find(item => item.detection_id === inspectedDetectionId);
  const all = [...roi.polygons.flat(2), ...(showOutside ? visibleGeometry.flatMap(item => item.geometry.polygons.flat(2)) : [])];
  const xs = all.map(p => p.x_m), ys = all.map(p => p.y_m);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(.1, Math.max(...xs) - minX), height = Math.max(.1, Math.max(...ys) - minY);
  const unit = Math.max(width, height) / 65, pad = unit * 10;
  const background = gaps.background_regions.find(item => item.id === backgroundId);
  const selected = background ? undefined : gaps.candidates.find(item => item.id === selectedId);
  const greyDisplay = unknownGapDisplay(gaps.candidates, previewWidthOnly);
  const selectGap = (id: string) => { onInspectBackground(); onSelect(id); };
  const selectIncoming = (id: string) => { onInspectBackground(); onSelectIncoming(id); };
  return <section aria-label="แผนผัง 2D segmentation" className="space-y-3 border-t p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">2D มุมบน · ช่องว่างจาก segmentation (ทดลอง)</h3>
      <div className="flex gap-2">
        <button type="button" aria-label="ย่อแผนผัง segmentation" className="rounded border px-3 py-1" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1}>−</button>
        <button type="button" aria-label="ขยายแผนผัง segmentation" className="rounded border px-3 py-1" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom === 4}>+</button>
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => setZoom(1)}>พอดีแผนผัง</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {segmentationOnly ? <p className="font-medium text-cyan-900" data-occupancy-source="SEGMENTATION_ONLY">หาช่วงว่างด้วย {modelName} เท่านั้น</p> : <label>กรอบรถที่แสดง <select aria-label="detector ของแผนผัง 2D" value={detector} onChange={event => { setDetector(event.target.value); setZoom(1); }} className="rounded border p-1">
        <option value="SEGMENTATION">{modelName}</option><option value="PRIMARY">Detector เดิม</option><option value="BOTH">ทั้งสองโมเดล (อาจมีกรอบซ้ำ)</option>
      </select></label>}
      <label><input type="checkbox" aria-label="แสดงรถนอก ROI" checked={showOutside} onChange={event => { setShowOutside(event.target.checked); setZoom(1); }} /> แสดงรถนอก ROI</label>
      <label className="font-medium text-green-900"><input type="checkbox" aria-label="ทดลองแสดงช่องกว้างพอ" checked={previewWidthOnly} onChange={event => onPreviewWidthOnly(event.target.checked)} /> ทดลอง: แสดงช่องกว้างพอเป็นสีเขียวลายเฉียง</label>
      {orientationPreview && <label className="font-medium text-cyan-900"><input type="checkbox" aria-label="ทดลองเดาแนวรถจากกรอบภาพ" checked={orientationPreview.enabled} onChange={event => orientationPreview.onToggle(event.target.checked)} /> ทดลองเดาแนวรถจากกรอบภาพ · เส้นประฟ้า</label>}
    </div>
    <p className="text-xs text-slate-600">กรอบแดง = รถอ้างอิง · ม่วง = แถว · {shapes ? 'เขียว = มีแนววัดกว้างพอในรูปทรง · แดง = แคบกว่าเกณฑ์' : continuous ? 'กรอบเขียว = กว้างพอตามเกณฑ์ · แดง = แคบกว่าเกณฑ์' : slots ? 'เขียว = ช่องจำลองผ่านเกณฑ์' : fullFit ? 'กรอบเขียว = วางรถทั้งคันได้ตามแบบจำลอง' : 'เส้นเขียว = กว้างพอ'} · เทา = ยังยืนยันไม่ได้ · ขอบฟ้า = ช่วงที่เลือก</p>
    <p className="text-xs text-slate-600">คลิกพื้นสีขาวภายในแถวเพื่อดูเหตุผล · สีขาวไม่ใช่พื้นที่ว่างที่ยืนยันแล้ว · สีเทาที่ติดกันในแถวเดียวกันแสดงรวมเป็นช่วงเดียว กดดูเหตุผลย่อยได้ สถานะและจำนวนผลประเมินคงเดิม</p>
    {!showOutside && <p className="text-xs text-slate-600">สีแดงขยายเต็มความลึกแถวตามช่วงความกว้างของกรอบรถ เป็นแนวพื้นที่ที่ระบบกันไว้ ไม่ใช่ขนาดตัวรถจริง · {gaps.row_owned_references ? 'รถที่ระบุแถวได้ใช้กรอบคำนวณเฉพาะภายในแถวนั้น รถกำกวมยังคงความไม่แน่นอน' : 'การคำนวณใช้กรอบรถเดิม รวมส่วนที่ยื่นออกจากแถว'}</p>}
    <p className="text-xs text-amber-900">{shapes ? 'วัดความกว้างภายในรูปทรงที่เหลือ โดยเก็บรูและส่วนเว้าไว้ · เส้นประฟ้าคือความลึกตรงกลางแนววัด ไม่ได้ตรวจความยาวรถหรือทางเข้า–ออก' : continuous ? `ทุกกรอบคือช่วงว่างเต็มความกว้าง ลึกตามแถว · เกณฑ์รถ ${gaps.target_width_m.toFixed(3)} + เผื่อรวม ${gaps.clearance_margin_m.toFixed(3)} ม. · ยังไม่ตรวจความยาวรถหรือทางเข้า–ออก` : slots ? 'แต่ละช่องกว้าง 1 ม. ลึกตามแถวนั้นใน Setup ไม่ใช่ช่องตีเส้นจริง · ตรวจแต่ละช่องแยกกัน ยังไม่ตรวจความยาวรถรายรุ่นหรือทางเข้า–ออก' : fullFit ? `ตรวจกรอบรถ ${gaps.target_width_m.toFixed(2)} × ${(gaps.target_length_m ?? 0).toFixed(2)} ม.` : 'วัดช่องด้านข้างที่กึ่งกลางแถว ไม่ตรวจความยาวรถ'} · การซ่อนกรอบไม่เปลี่ยนการคำนวณ · พื้นหลังไม่ใช่พื้นที่ว่างที่ยืนยันแล้ว</p>
    {segmentationOnly && <p className="text-xs text-amber-900">ใช้ mask ตรวจการบังในภาพ คันที่ mask ใช้ไม่ได้ใช้กรอบสำรอง · รถที่จัดแถวไม่ชัดเจนยังมีความไม่แน่นอนในการคำนวณ</p>}
    {(continuous || shapes) && <p className="text-xs text-yellow-900">สีเหลือง = อาจจอดได้หากขยับรถข้างเคียง · ขาดความกว้างไม่เกิน {(gaps.advisory_max_extra_width_m*100).toFixed(0)} ซม. และกรอบเป้าหมายทับรถไม่เกิน {(gaps.advisory_max_overlap_ratio*100).toFixed(0)}% · ไม่ใช่ช่องที่พร้อมจอด</p>}
    {previewWidthOnly && <p role="status" aria-label="คำอธิบายโหมดความกว้างทดลอง" className="rounded border border-green-700 bg-green-50 p-3 text-sm font-medium text-green-950">เขียวลายเฉียง = {widthPreviewLabel} · เป็นภาพทดลองเฉพาะความกว้าง สถานะจริงยังเป็น UNKNOWN เหตุผลเดิมยังอยู่ และไม่นับเพิ่มในจำนวนช่วงผ่านเกณฑ์หรือคำแนะนำ</p>}
    <div className="h-[460px] max-h-[65vh] overflow-auto rounded-xl border bg-slate-200">
      <svg aria-label="Segmentation metric top-down map" viewBox={`${minX-pad} ${minY-pad} ${width+2*pad} ${height+2*pad}`} style={{ width: `${zoom*100}%`, height: `${zoom*100}%` }} className="block" preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(0 ${2*minY+height}) scale(1 -1)`}>
        <defs><clipPath id={clipId}>{roi.polygons.map((polygon, index) => <path key={index} d={path(polygon)} clipRule="evenodd" />)}</clipPath>
          <clipPath id={rowClipId} clipPathUnits="userSpaceOnUse">{gaps.rows.map(row => <polygon key={row.row_id} points={points(row.polygon_metric)} />)}</clipPath>
          <pattern id={widthPatternId} patternUnits="userSpaceOnUse" width={unit*.7} height={unit*.7} patternTransform="rotate(45)"><rect width={unit*.7} height={unit*.7} fill="#dcfce7" /><line x1="0" y1="0" x2="0" y2={unit*.7} stroke="#15803d" strokeWidth={unit*.22} /></pattern>
        </defs>
        {roi.polygons.map((polygon, index) => <path key={index} d={path(polygon)} fill="#f1f5f9" fillRule="evenodd" stroke="#475569" strokeWidth={unit*.1} />)}
        {gaps.background_regions.map(region => <path key={region.id} data-background-id={region.id} data-background-kind={region.kind} d={region.geometry.polygons.map(rings => path(rings)).join(' ')} fill="transparent" fillRule="evenodd" stroke="none" pointerEvents="fill" className="cursor-help"
          role="button" tabIndex={0} aria-label={`พื้นหลัง ${region.row_id} ${region.kind === 'OCCUPIED_REFERENCE' ? 'ระบบนับเป็นพื้นที่รถอ้างอิง' : 'ยังไม่มีผลประเมิน'}`}
          onClick={() => onInspectBackground(region)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspectBackground(region); } }}>
          <title>{region.row_id} · {region.kind === 'OCCUPIED_REFERENCE' ? 'ระบบนับเป็นพื้นที่รถอ้างอิง' : 'ยังไม่มีผลประเมินตำแหน่งนี้'}</title>
        </path>)}
        {greyDisplay.map(group => <path key={group.rowId} data-unknown-display-row={group.rowId}
          d={group.polygons.flatMap(polygon => polygon.map(ring => `M${ring.map(([x,y]) => `${x},${y}`).join(' L')} Z`)).join(' ')}
          fill={gapPresentation.UNKNOWN.fill} fillOpacity={rectangles ? .65 : 1} fillRule="evenodd"
          stroke={gapPresentation.UNKNOWN.color} strokeWidth={unit*(rectangles ? .1 : .5)} className="pointer-events-none" />)}
        {gaps.candidates.map(item => <g key={item.id}>
          {item.id === selected?.id && <path d={metricGapPath(item)} fill="none" stroke="#2563eb" strokeWidth={unit*(rectangles ? .35 : .95)} className="pointer-events-none" />}
          <path data-state={item.state} data-visibility={item.visibility} data-occlusion-count={item.occlusion_evidence.length} data-width-check={item.width_check} data-width-preview={isWidthPreview(item, previewWidthOnly)} data-gap-id={item.id} data-slot-width={slots ? item.gap_width_m : undefined} data-slot-length={item.slot_length_m ?? undefined} d={metricGapPath(item)} fillRule="evenodd"
          fill={isWidthPreview(item, previewWidthOnly) ? `url(#${widthPatternId})` : item.state === 'UNKNOWN' ? 'transparent' : gapPresentation[item.state].fill} fillOpacity={rectangles ? .65 : 1} stroke={item.state === 'UNKNOWN' && !isWidthPreview(item, previewWidthOnly) ? 'none' : gapPresentation[item.state].color} strokeWidth={unit*(rectangles ? .1 : .5)}
          tabIndex={0} role="button" aria-label={`2D ${item.id} ${item.gap_width_m.toFixed(2)} เมตร`}
          onClick={() => selectGap(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectGap(item.id); } }}>
          <title>{item.row_id} · {item.gap_width_m.toFixed(2)} ม. · {gapPresentation[item.state].label}{isWidthPreview(item, previewWidthOnly) ? ` · ${widthPreviewLabel}` : ''}</title>
        </path></g>)}
        <g clipPath={showOutside ? undefined : `url(#${clipId})`} className="pointer-events-none">
          <g data-row-clipped={!showOutside} clipPath={showOutside ? undefined : `url(#${rowClipId})`}>{visibleGeometry.flatMap(({ layer, geometry }) => geometry.polygons.map((polygon, index) => <path key={`${layer.detection_id}-${index}`} data-occupied="true" data-occupied-row={layer.assigned_row_id ?? undefined} data-occupied-display={!showOutside && layer.row_depth_geometry ? 'ROW_DEPTH' : 'REFERENCE'} data-source={layer.source} d={path(polygon)} fill="#fca5a5" fillOpacity=".8" fillRule="evenodd" stroke="#b91c1c" strokeWidth={unit*.08}><title>{layer.detection_id} · {layer.assigned_row_id ?? 'พบรถ แต่ยังระบุแถวไม่ได้'} · {!showOutside ? 'แนวพื้นที่รถอ้างอิง ขยายเต็มความลึกแถวเพื่อแสดงผล ไม่ใช่ขนาดรถจริง' : 'กรอบรถอ้างอิง'}</title></path>))}</g>
        </g>
        {inspectedGeometry && <g clipPath={showOutside ? undefined : `url(#${clipId})`} className="pointer-events-none"><g clipPath={showOutside ? undefined : `url(#${rowClipId})`}>
          <path data-inspected-detection={inspectedDetectionId} d={inspectedGeometry.geometry.polygons.map(polygon => path(polygon)).join(' ')} fill="rgba(249,115,22,.2)" fillRule="evenodd" stroke="#ea580c" strokeWidth={unit*.3}><title>{inspectedDetectionId} · รถที่เลือก</title></path>
        </g></g>}
        {gaps.rows.map(row => <g key={row.row_id} className="pointer-events-none">
          <polygon clipPath={`url(#${clipId})`} points={points(row.polygon_metric)} fill="none" stroke="#9333ea" strokeWidth={unit*.13} />
          {row.bottom_edge_metric.length === 2 && <line data-row-bottom-edge={row.row_id} x1={row.bottom_edge_metric[0].x_m} y1={row.bottom_edge_metric[0].y_m} x2={row.bottom_edge_metric[1].x_m} y2={row.bottom_edge_metric[1].y_m} stroke="#0d9488" strokeWidth={unit*.2}><title>เส้นล่างอ้างอิง {row.row_id}</title></line>}
          {row.label_metric && row.polygon_metric.length > 0 && <text data-row-label={row.row_id} transform={`translate(0 ${2*row.label_metric.y_m}) scale(1 -1)`} x={Math.min(...row.polygon_metric.map(p => p.x_m))-unit*.4} y={row.label_metric.y_m} fontSize={unit*2.2} textAnchor="end" fill="#6b21a8" stroke="white" strokeWidth={unit*.07} paintOrder="stroke">{row.row_id}</text>}
        </g>)}
        {gaps.candidates.filter(item => item.id === selected?.id).map(item => <g key={item.id} className="pointer-events-none" data-selected-distance="true">
          {item.near_fit && <polygon data-advisory-target={item.id} points={points(item.near_fit.target_polygon_metric)} fill="none" stroke="#a16207" strokeDasharray={`${unit*.4} ${unit*.25}`} strokeWidth={unit*.2} />}
          {item.width_line_metric.length === 2 && <line x1={item.width_line_metric[0].x_m} y1={item.width_line_metric[0].y_m} x2={item.width_line_metric[1].x_m} y2={item.width_line_metric[1].y_m} stroke={gapPresentation[item.state].color} strokeWidth={unit*.13} />}
          {item.depth_line_metric.length === 2 && <line data-depth-witness={item.id} x1={item.depth_line_metric[0].x_m} y1={item.depth_line_metric[0].y_m} x2={item.depth_line_metric[1].x_m} y2={item.depth_line_metric[1].y_m} stroke="#0e7490" strokeDasharray={`${unit*.4} ${unit*.25}`} strokeWidth={unit*.13} />}
          {item.label_metric && <text transform={`translate(0 ${2*(item.label_metric.y_m+unit*.8)}) scale(1 -1)`} x={item.label_metric.x_m} y={item.label_metric.y_m+unit*.8} textAnchor="middle" fontSize={unit*2.2} fill="#0f172a" stroke="white" strokeWidth={unit*.1} paintOrder="stroke">{item.gap_width_m.toFixed(2)} ม.</text>}
        </g>)}
        {gaps.incoming_vehicle?.candidates.filter(item => item.state === 'SLOT_CLEAR' || item.state === 'WIDTH_SUFFICIENT').map(item => <path key={item.id} data-incoming-id={item.id} d={metricGapPath(item)} fillRule="evenodd"
          fill={item.id === incomingSelectedId ? 'rgba(6,182,212,.3)' : 'none'} stroke="#0891b2" strokeOpacity={item.id === incomingSelectedId ? 1 : .4} strokeWidth={unit*(item.id === incomingSelectedId ? .35 : .1)}
          role="button" tabIndex={0} aria-label={`ตำแหน่งรถที่กรอก ${item.row_id}`} onClick={() => selectIncoming(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectIncoming(item.id); } }}>
          <title>รถกว้าง {gaps.incoming_vehicle?.width_m.toFixed(3)} ม. · แนววัดกว้าง {item.gap_width_m.toFixed(2)} ม.</title>
        </path>)}
        {background && <path data-selected-background={background.id} d={background.geometry.polygons.map(rings => path(rings)).join(' ')} fill="rgba(99,102,241,.12)" fillRule="evenodd" stroke="#4338ca" strokeWidth={unit*.2} strokeDasharray={`${unit*.4} ${unit*.2}`} className="pointer-events-none" />}
        {orientationPreview?.enabled && <OrientationMetricOverlay hypotheses={gaps.orientation_hypotheses} control={orientationPreview} unit={unit} clipId={showOutside ? undefined : clipId} />}
        {horizontalPreview?.enabled && <HorizontalVehicleMetricOverlay vehicles={gaps.horizontal_vehicles ?? []} control={horizontalPreview} unit={unit} clipId={clipId} />}
        <RowDistanceMetricOverlay assignment={distanceAssignment} unit={unit} />
        </g>
      </svg>
    </div>
    {horizontalPreview && <HorizontalVehiclePanel vehicles={gaps.horizontal_vehicles ?? []} control={horizontalPreview} />}
    {orientationPreview?.enabled && <GapOrientationPreview gaps={gaps} control={orientationPreview} />}
    {occlusionInspector}
    {shapes && <p data-visible-shape-help className="rounded border border-cyan-300 bg-cyan-50 p-3 text-sm">เก็บพื้นที่ที่เหลือหลังหักรถอ้างอิง แยกส่วนที่ถูกบังเป็นสีเทาเฉพาะบริเวณ · สีเขียวหมายถึงพบแนววัดภายในรูปทรงที่กว้างพอ ไม่ใช่ทุกจุดในรูปทรงจอดได้ · เส้นประฟ้าคือความลึกตรงกลางแนววัด ยังไม่ตรวจความยาวรถหรือทางเข้า–ออก</p>}
    {background && <section aria-label="รายละเอียดพื้นที่สีขาว" role="status" className="space-y-2 rounded-xl border border-indigo-300 bg-indigo-50 p-4 text-sm text-indigo-950">
      <h4 className="font-semibold">{background.row_id} · {background.kind === 'OCCUPIED_REFERENCE' ? 'ระบบนับเป็นพื้นที่รถอ้างอิง' : 'ยังไม่มีผลประเมินตำแหน่งนี้'}</h4>
      {background.kind === 'OCCUPIED_REFERENCE' ? <p>พื้นที่นี้ถูกนับรวมในกรอบรถอ้างอิงที่ใช้คำนวณ จึงไม่ได้แสดงเป็นช่วงว่าง ขนาดและตำแหน่งเป็นค่าประมาณ ไม่ใช่ขอบรถจริง</p> : <p>{background.reasons.map(reason => gapReasonLabels[reason] ?? reason).join(' · ')} · ระบบตรวจแนวตลอดความลึกแถว ไม่ได้ตัดสินจากสีขาวอย่างเดียว</p>}
      {background.detection_ids.length > 0 && <p className="text-xs">รถอ้างอิงที่เกี่ยวข้องกับบริเวณนี้: {background.detection_ids.join(', ')}</p>}
      <p className="text-xs font-medium">สีขาวไม่ใช่การยืนยันว่าพื้นที่ว่างหรือจอดได้ กรอบสีน้ำเงินเข้มแสดงบริเวณที่เลือกเท่านั้น</p>
      <button type="button" onClick={() => onInspectBackground()} className="rounded border border-indigo-300 bg-white px-3 py-1">ปิดรายละเอียดพื้นสีขาว</button>
    </section>}
    <GapNearFitAdvice gap={selected} />
    {gaps.incoming_vehicle && <IncomingVehicleRecommendations result={gaps.incoming_vehicle} selectedId={incomingSelectedId} onSelect={onSelectIncoming} />}
    {!background && (gaps.incoming_vehicle ? <details className="rounded-xl border p-3 text-sm">
      <summary className="cursor-pointer">ดูรุ่นที่กว้างพอกับช่วงว่างที่เลือก</summary>
      <div className="mt-3"><GapFamilyRecommendations gap={selected} error={gaps.family_recommendation_error} /></div>
    </details> : <GapFamilyRecommendations gap={selected} error={gaps.family_recommendation_error} />)}
    <section aria-label="ผลช่องว่างทุกแถว" className="space-y-3 rounded-xl border p-3 text-sm">
      <h4 className="font-semibold">{shapes || continuous ? 'ผลช่องว่างทุกแถว · รถกว้าง' : slots ? 'ช่องจำลองกว้าง' : 'ผลค้นหาพื้นที่ว่าง · รถ'} {gaps.target_width_m.toFixed(2)}{fullFit ? ` × ${(gaps.target_length_m ?? 0).toFixed(2)}` : ''} ม.{shapes || continuous ? ` + เผื่อรวม ${gaps.clearance_margin_m.toFixed(2)} ม.${shapes ? ' · วัดภายในรูปทรง' : ' · ลึกตามแถว'}` : slots ? ' · ลึกตามแถว' : ''}</h4>
      <p>{slots ? `ผ่านเกณฑ์ ${gaps.green_count} ช่อง` : fullFit ? `วางกรอบรถได้ ${gaps.green_count} ตำแหน่งทดลอง` : `กว้างพอ ${gaps.green_count} ช่วง · แคบเกินไป ${gaps.narrow_count} ช่วง`} · ยังยืนยันไม่ได้ {gaps.unknown_count} {slots ? 'ช่อง' : 'ตำแหน่ง'}</p>
      {(continuous || shapes) && <p className="font-medium text-yellow-900">สีเหลือง อาจจอดได้หากขยับรถ: {gaps.almost_count} ช่วง · แยกจากช่วงสีเขียว</p>}
      {fullFit && <p className="text-xs text-amber-900">จำนวนตำแหน่งเป็นผลทดลอง ไม่ใช่จำนวนที่จอดที่รับรองหรือช่องจอดประจำ</p>}
      {[...gaps.rows].sort((a,b) => b.row_id.localeCompare(a.row_id, undefined, { numeric: true })).map(row => <div key={row.row_id} className="space-y-2 border-t pt-2">
        <h5 className="font-medium text-purple-800">{row.row_id}</h5>
        {row.reasons.length > 0 && <p className="text-xs text-amber-900">{row.uncertainty_scope === 'LOCAL_REFERENCE_ENVELOPE' ? 'ตรวจความไม่แน่นอนแยกบริเวณ: ' : 'ยังยืนยันทั้งแถวไม่ได้: '}{row.reasons.map(reason => gapReasonLabels[reason] ?? reason).join(' · ')}{row.affected_detection_ids.length > 0 ? ` · รถอ้างอิงที่เกี่ยวข้อง: ${row.affected_detection_ids.join(', ')}` : ''}</p>}
        {gaps.candidates.filter(item => item.row_id === row.row_id).map((item, index) => <button type="button" key={item.id} data-gap-result={item.id} data-state={item.state} aria-pressed={item.id === selected?.id} onClick={() => selectGap(item.id)} className={`flex w-full flex-wrap justify-between gap-2 rounded border px-3 py-2 text-left ${item.id === selected?.id ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`} style={{ borderColor: gapPresentation[item.state].color }}>
          <span>{slots ? 'ช่องจำลอง' : fullFit ? 'ตำแหน่ง' : 'ช่วง'} {index+1} · {item.gap_width_m.toFixed(2)}{item.slot_length_m != null ? ` × ${item.slot_length_m.toFixed(2)}` : ''} ม.</span><strong style={{ color: gapPresentation[item.state].color }}>{gapPresentation[item.state].label}</strong>
          {item.reasons.length > 0 && <span className="w-full text-xs text-slate-500">{item.reasons.map(reason => gapReasonLabels[reason] ?? reason).join(' · ')}</span>}
          {item.depth_at_width_midpoint_m != null && <span className="w-full text-xs text-cyan-900">ลึกตรงกลางแนววัด {item.depth_at_width_midpoint_m.toFixed(2)} ม. · ไม่ใช่ความลึกที่ยืนยันตลอดความกว้าง</span>}
          {item.uncertain_detection_ids.length > 0 && <span className="w-full text-xs text-amber-800">รถอ้างอิงที่กระทบช่วงนี้: {item.uncertain_detection_ids.join(', ')}</span>}
          {isWidthPreview(item, previewWidthOnly) && <span className="w-full text-xs font-semibold text-green-900">ทดลอง: {widthPreviewLabel}</span>}
          {item.near_fit && <span className="w-full text-xs font-semibold text-yellow-900">ขาดความกว้าง {(item.near_fit.required_extra_width_m*100).toFixed(1)} ซม. · ยังไม่ตรวจแผนขยับรถ</span>}
        </button>)}
        {!gaps.candidates.some(item => item.row_id === row.row_id) && <p className="text-slate-500">{fullFit ? 'ยังไม่พบตำแหน่งวางกรอบรถทั้งคัน ดูข้อมูลช่องแคบ/สั้นหรือสถานะ calibration ด้านล่าง' : 'ไม่มีช่องที่วัดได้ในผลนี้'}</p>}
      </div>)}
    </section>
    {selected && <p aria-label="ช่องว่าง 2D ที่เลือก" className="text-sm">{selected.row_id} · ช่อง {selected.gap_width_m.toFixed(2)}{selected.slot_length_m != null ? ` × ${selected.slot_length_m.toFixed(2)}` : ''} ม. · {gapPresentation[selected.state].label} · ยังไม่ตรวจความยาวรถรายรุ่นหรือทางเข้า–ออก</p>}
    <p className="text-xs text-amber-900">ตำแหน่งและขนาดรถเป็นค่าอ้างอิงบนพื้นจาก calibration ไม่ใช่รูปทรงจริงจาก mask · มุมมองนี้ใช้ผลคำนวณเดียวกับภาพกล้อง พื้นที่ถูกบังยังยืนยันไม่ได้</p>
  </section>;
}
