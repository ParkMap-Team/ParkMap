"use client";

import { useId, useState } from 'react';
import type { components } from '@/types/api.gen';
import { gapPresentation } from '@/lib/segmentationGapPresentation';

type Gaps = components['schemas']['SegmentationGapResult'];
type Point = components['schemas']['MetricGroundPoint'];
const points = (ring: Point[]) => ring.map(p => `${p.x_m},${p.y_m}`).join(' ');
const path = (rings: Point[][]) => rings.map(ring => ring.length ? `M${ring.map(p => `${p.x_m},${p.y_m}`).join(' L')} Z` : '').join(' ');

export function SegmentationTopDown({ gaps, selectedId, onSelect }: {
  gaps: Gaps; selectedId?: string; onSelect: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [showOutside, setShowOutside] = useState(false);
  const [detector, setDetector] = useState('SEGMENTATION');
  const clipId = useId();
  const roi = gaps.parking_roi_metric;
  if (!roi?.polygons.length) return <p className="border-t p-4 text-sm text-amber-800">แผนผัง 2D ทดลองต้องมี calibration ที่ตรงกับภาพก่อน</p>;
  const layers = gaps.occupied_layers.filter(layer => detector === 'BOTH' || layer.source === detector);
  const visibleGeometry = layers.map(layer => ({ layer, geometry: showOutside ? layer.geometry : layer.roi_geometry }));
  const all = [...roi.polygons.flat(2), ...(showOutside ? visibleGeometry.flatMap(item => item.geometry.polygons.flat(2)) : [])];
  const xs = all.map(p => p.x_m), ys = all.map(p => p.y_m);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(.1, Math.max(...xs) - minX), height = Math.max(.1, Math.max(...ys) - minY);
  const unit = Math.max(width, height) / 65, pad = unit * 10;
  const selected = gaps.candidates.find(item => item.id === selectedId);
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
      <label>กรอบรถที่แสดง <select aria-label="detector ของแผนผัง 2D" value={detector} onChange={event => { setDetector(event.target.value); setZoom(1); }} className="rounded border p-1">
        <option value="SEGMENTATION">YOLO11m-seg</option><option value="PRIMARY">Detector เดิม</option><option value="BOTH">ทั้งสองโมเดล (อาจมีกรอบซ้ำ)</option>
      </select></label>
      <label><input type="checkbox" aria-label="แสดงรถนอก ROI" checked={showOutside} onChange={event => { setShowOutside(event.target.checked); setZoom(1); }} /> แสดงรถนอก ROI</label>
    </div>
    <p className="text-xs text-slate-600">กรอบแดง = รถอ้างอิง · ม่วง = แถว · เส้นเขียว = กว้างพอ · เส้นแดง = แคบเกินไป · เทา = ยังยืนยันไม่ได้ · ขอบฟ้า = ช่องที่เลือก</p>
    <p className="text-xs text-amber-900">วัดช่องด้านข้างที่แนวกึ่งกลางแถว ไม่ตรวจความยาวรถ · การซ่อนกรอบไม่เปลี่ยนการคำนวณ ซึ่งยังใช้สิ่งกีดขวางจากทั้งสองโมเดล · พื้นหลังไม่ใช่พื้นที่ว่างที่ยืนยันแล้ว</p>
    <div className="h-[460px] max-h-[65vh] overflow-auto rounded-xl border bg-slate-200">
      <svg aria-label="Segmentation metric top-down map" viewBox={`${minX-pad} ${minY-pad} ${width+2*pad} ${height+2*pad}`} style={{ width: `${zoom*100}%`, height: `${zoom*100}%` }} className="block" preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(0 ${2*minY+height}) scale(1 -1)`}>
        <defs><clipPath id={clipId}>{roi.polygons.map((polygon, index) => <path key={index} d={path(polygon)} clipRule="evenodd" />)}</clipPath></defs>
        {roi.polygons.map((polygon, index) => <path key={index} d={path(polygon)} fill="#f1f5f9" fillRule="evenodd" stroke="#475569" strokeWidth={unit*.1} />)}
        {gaps.candidates.map(item => <g key={item.id}>
          {item.id === selectedId && <polygon points={points(item.polygon_metric)} fill="none" stroke="#2563eb" strokeWidth={unit*.95} className="pointer-events-none" />}
          <polygon data-state={item.state} data-gap-id={item.id} points={points(item.polygon_metric)}
          fill={gapPresentation[item.state].fill} stroke={gapPresentation[item.state].color} strokeWidth={unit*.5}
          tabIndex={0} role="button" aria-label={`2D ${item.id} ${item.gap_width_m.toFixed(2)} เมตร`}
          onClick={() => onSelect(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id); } }}>
          <title>{item.row_id} · {item.gap_width_m.toFixed(2)} ม. · {gapPresentation[item.state].label}</title>
        </polygon></g>)}
        <g clipPath={showOutside ? undefined : `url(#${clipId})`} className="pointer-events-none">{visibleGeometry.flatMap(({ layer, geometry }) => geometry.polygons.map((polygon, index) => <path key={`${layer.detection_id}-${index}`} data-occupied="true" data-source={layer.source} d={path(polygon)} fill="#fca5a5" fillOpacity=".8" fillRule="evenodd" stroke="#b91c1c" strokeWidth={unit*.08}><title>{layer.source} · กรอบรถอ้างอิง ไม่ใช่ขอบรถจริงบนพื้น</title></path>))}</g>
        {gaps.rows.map(row => <g key={row.row_id} className="pointer-events-none">
          <polygon clipPath={`url(#${clipId})`} points={points(row.polygon_metric)} fill="none" stroke="#9333ea" strokeWidth={unit*.13} />
          {row.label_metric && row.polygon_metric.length > 0 && <text data-row-label={row.row_id} transform={`translate(0 ${2*row.label_metric.y_m}) scale(1 -1)`} x={Math.min(...row.polygon_metric.map(p => p.x_m))-unit*.4} y={row.label_metric.y_m} fontSize={unit*2.2} textAnchor="end" fill="#6b21a8" stroke="white" strokeWidth={unit*.07} paintOrder="stroke">{row.row_id}</text>}
        </g>)}
        {gaps.candidates.filter(item => item.id === selectedId).map(item => <g key={item.id} className="pointer-events-none" data-selected-distance="true">
          {item.width_line_metric.length === 2 && <line x1={item.width_line_metric[0].x_m} y1={item.width_line_metric[0].y_m} x2={item.width_line_metric[1].x_m} y2={item.width_line_metric[1].y_m} stroke={gapPresentation[item.state].color} strokeWidth={unit*.13} />}
          {item.label_metric && <text transform={`translate(0 ${2*(item.label_metric.y_m+unit*.8)}) scale(1 -1)`} x={item.label_metric.x_m} y={item.label_metric.y_m+unit*.8} textAnchor="middle" fontSize={unit*2.2} fill="#0f172a" stroke="white" strokeWidth={unit*.1} paintOrder="stroke">{item.gap_width_m.toFixed(2)} ม.</text>}
        </g>)}
        </g>
      </svg>
    </div>
    <section aria-label="ผลช่องว่างทุกแถว" className="space-y-3 rounded-xl border p-3 text-sm">
      <h4 className="font-semibold">ผลค้นหาช่องว่าง · เกณฑ์กว้าง {gaps.target_width_m.toFixed(2)} ม.</h4>
      <p>กว้างพอ {gaps.green_count} ช่วง · แคบเกินไป {gaps.narrow_count} ช่วง · ยังยืนยันไม่ได้ {gaps.unknown_count} ช่วง</p>
      {[...gaps.rows].sort((a,b) => b.row_id.localeCompare(a.row_id, undefined, { numeric: true })).map(row => <div key={row.row_id} className="space-y-2 border-t pt-2">
        <h5 className="font-medium text-purple-800">{row.row_id}</h5>
        {gaps.candidates.filter(item => item.row_id === row.row_id).map((item, index) => <button type="button" key={item.id} data-gap-result={item.id} data-state={item.state} aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)} className={`flex w-full flex-wrap justify-between gap-2 rounded border px-3 py-2 text-left ${item.id === selectedId ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`} style={{ borderColor: gapPresentation[item.state].color }}>
          <span>ช่วง {index+1} · {item.gap_width_m.toFixed(2)} ม.</span><strong style={{ color: gapPresentation[item.state].color }}>{gapPresentation[item.state].label}</strong>
        </button>)}
        {!gaps.candidates.some(item => item.row_id === row.row_id) && <p className="text-slate-500">ไม่มีช่องที่วัดได้ในผลนี้</p>}
      </div>)}
    </section>
    {selected && <p aria-label="ช่องว่าง 2D ที่เลือก" className="text-sm">{selected.row_id} · กว้าง {selected.gap_width_m.toFixed(2)} ม. · {gapPresentation[selected.state].label} · ยังไม่ตรวจความยาวรถ</p>}
    <p className="text-xs text-amber-900">ตำแหน่งและขนาดรถเป็นค่าอ้างอิงบนพื้นจาก calibration ไม่ใช่รูปทรงจริงจาก mask · มุมมองนี้ใช้ผลคำนวณเดียวกับภาพกล้อง พื้นที่ถูกบังยังยืนยันไม่ได้</p>
  </section>;
}
