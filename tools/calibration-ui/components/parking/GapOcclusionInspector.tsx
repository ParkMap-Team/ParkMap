'use client';

import { useState } from 'react';
import type { components } from '@/types/api.gen';

type Gap = components['schemas']['GapCandidate'];
type Background = components['schemas']['GapBackgroundRegion'];
type Selection = Gap | Background;
type Source = components['schemas']['GapImageSource'];
type Result = components['schemas']['SegmentationExperimentResult'];
type Evidence = components['schemas']['GapOcclusionEvidence'];
type Point = components['schemas']['MaskPoint'];
const points = (ring: Point[]) => ring.map(p => `${p.x},${p.y}`).join(' ');
const path = (rings: Point[][]) => rings.map(ring => ring.length ? `M${ring.map(p => `${p.x},${p.y}`).join(' L')} Z` : '').join(' ');
const imageGeometry = (selection: Selection) => 'kind' in selection ? selection.image_geometry : selection.geometry_metric ? selection.geometry_image : selection.polygon_image ? { polygons: [[selection.polygon_image]] } : null;
const relatedSources = (selection: Selection): Source[] => [...new Map([...selection.occlusion_evidence, ...('kind' in selection ? selection.depth_blockers : [])].map(item => [item.detection_id, item])).values()];

export function GapOcclusionOverlay({ gap, result, evidence = gap.occlusion_evidence, sources = relatedSources(gap) }: { gap: Selection; result: Result; evidence?: Evidence[]; sources?: Source[] }) {
  const geometry = imageGeometry(gap);
  return <g className="pointer-events-none" data-image-inspection={gap.id}>
    {sources.map(item => {
      const source = result.detections[item.detection_index];
      const overlap = evidence.find(entry => entry.detection_id === item.detection_id);
      return <g key={item.detection_id} data-related-detection={item.detection_id} data-occluding-detection={overlap ? item.detection_id : undefined}>
        {source && (item.source_kind === 'MASK' && source.polygon ? <polygon points={points(source.polygon)} fill="none" stroke="#ea580c" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          : <rect x={source.bbox.x} y={source.bbox.y} width={source.bbox.width} height={source.bbox.height} fill="none" stroke="#ea580c" strokeWidth="2.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
        {overlap?.overlap_image.polygons.map((rings, index) => <path key={index} data-occlusion-overlap={item.detection_id} d={path(rings)} fill="#e879f9" fillOpacity=".75" fillRule="evenodd" stroke="#86198f" strokeWidth="1.5" vectorEffect="non-scaling-stroke"><title>{item.detection_id} · ส่วนที่ทับบริเวณที่เลือกในภาพ</title></path>)}
      </g>;
    })}
    {geometry?.polygons.map((rings, index) => <path key={index} d={path(rings)} fill="none" fillRule="evenodd" stroke="#1d4ed8" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
  </g>;
}

export function GapOcclusionInspector({ gap, result, showOverlay, onShowOverlay }: {
  gap: Selection; result: Result; showOverlay: boolean; onShowOverlay: (value: boolean) => void;
}) {
  const [focus, setFocus] = useState<{ gap: Selection; detectionId: string } | null>(null);
  const background = 'kind' in gap;
  const sources = relatedSources(gap);
  const focused = focus?.gap === gap ? sources.find(item => item.detection_id === focus.detectionId) : undefined;
  const visible = focused ? [focused] : sources;
  const evidence = focused ? gap.occlusion_evidence.filter(item => item.detection_id === focused.detection_id) : gap.occlusion_evidence;
  // Bounds affect only the crop display; all overlap decisions come from Python.
  const all = [...(imageGeometry(gap)?.polygons.flat(2) ?? []), ...visible.flatMap(item => {
    const source = result.detections[item.detection_index];
    return source ? [{ x: source.bbox.x, y: source.bbox.y }, { x: source.bbox.x+source.bbox.width, y: source.bbox.y+source.bbox.height }] : [];
  })];
  const left = Math.max(0, Math.min(...all.map(p => p.x))-.025);
  const top = Math.max(0, Math.min(...all.map(p => p.y))-.025);
  const right = Math.min(1, Math.max(...all.map(p => p.x))+.025);
  const bottom = Math.min(1, Math.max(...all.map(p => p.y))+.025);
  return <section aria-label="ตรวจการบังของช่องที่เลือก" data-occlusion-gap={gap.id} data-inspection-kind={background ? 'BACKGROUND' : 'CANDIDATE'} className="space-y-3 rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-4 text-sm">
    <h4 className="font-semibold">{background ? 'ตรวจพื้นสีขาวบนภาพจริง' : 'ตรวจการบังบนภาพจริง'} · {gap.row_id}{!background ? ` · กว้าง ${gap.gap_width_m.toFixed(2)} ม.` : ''}</h4>
    <p>ชมพู = ส่วนที่ทับกันในภาพ · ส้ม = รถที่เกี่ยวข้อง · น้ำเงิน = บริเวณที่เลือกฉายกลับบนภาพ</p>
    {!background && gap.width_blocking_detection_ids.length > 0 && <p className="text-amber-950">รถที่เป็นขอบช่วงความกว้างนี้: {gap.width_blocking_detection_ids.join(', ')} · แยกจากรถที่ mask บังในภาพ</p>}
    {background && gap.depth_blockers.length > 0 && <p className="text-amber-950">รถอ้างอิงที่อยู่ในแนวเดียวกันตลอดความลึกแถว: {gap.depth_blockers.map(item => item.detection_id).join(', ')} · เป็นเหตุที่ระบบไม่สร้างช่องเต็มความลึกตรงนี้ ไม่ได้แปลว่ารถเหล่านี้ทับพื้นสีขาวโดยตรงหรือบังในภาพทุกคัน</p>}
    <label className="flex items-center gap-2"><input type="checkbox" aria-label="แสดงส่วนที่รถทับช่องในภาพ" checked={showOverlay} onChange={event => onShowOverlay(event.target.checked)} /> แสดงส่วนที่ทับและกรอบรถบนภาพหลัก/ภาพขยาย</label>
    {!gap.occlusion_evidence_available ? <p className="text-amber-900">ผลนี้ไม่มีข้อมูลส่วนทับที่ตรวจสอบได้ กรุณาดูเหตุผลสถานะและตรวจ calibration</p>
      : gap.occlusion_evidence.length === 0 ? <p>ผลรอบนี้ไม่พบ mask หรือกรอบสำรองทับบริเวณที่เลือกในภาพ แต่ยังอาจติดเงื่อนไขแนวแถวหรือเงื่อนไขอื่น การไม่พบทับไม่ใช่การรับรองว่าจอดได้</p> : null}
    {sources.length > 0 && <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
          <button type="button" aria-pressed={!focused} onClick={() => setFocus(null)} className="rounded border bg-white px-3 py-2">แสดงรถที่เกี่ยวข้องทั้งหมด</button>
          {sources.map(item => { const overlap = gap.occlusion_evidence.find(entry => entry.detection_id === item.detection_id); return <button key={item.detection_id} type="button" data-occlusion-source={overlap ? item.detection_id : undefined} data-depth-blocker-source={!overlap ? item.detection_id : undefined} aria-pressed={item.detection_id === focused?.detection_id} onClick={() => setFocus({ gap, detectionId: item.detection_id })} className="rounded border border-fuchsia-300 bg-white px-3 py-2 text-left">
            {item.detection_id} · {item.source_kind === 'MASK' ? 'mask รถ' : 'กรอบสำรอง (mask ใช้ไม่ได้)'} · {overlap ? `ทับภาพบริเวณที่เลือก ${(overlap.candidate_overlap_ratio*100).toFixed(1)}%` : 'เกี่ยวข้องกับแนวตลอดความลึกแถว'}
          </button>; })}
        </div>}
    {result.preview_url && all.length > 0 && <svg aria-label="ภาพขยายตรวจการบัง" viewBox={`${left*result.image_width} ${top*result.image_height} ${Math.max(.01,right-left)*result.image_width} ${Math.max(.01,bottom-top)*result.image_height}`} preserveAspectRatio="xMidYMid meet" className="h-[340px] w-full rounded-lg border bg-slate-200">
      <g transform={`scale(${result.image_width} ${result.image_height})`}>
        <image href={result.preview_url} x="0" y="0" width="1" height="1" preserveAspectRatio="none" />
        {showOverlay && <GapOcclusionOverlay gap={gap} result={result} evidence={evidence} sources={visible} />}
      </g>
    </svg>}
    {(gap.occlusion_evidence_truncated || (background && gap.depth_blockers_truncated)) && <p className="text-amber-900">แสดงหลักฐานบางส่วน อาจมีรถที่เกี่ยวข้องเพิ่มเติม</p>}
    <p className="text-xs text-fuchsia-950">เปอร์เซ็นต์คือพื้นที่ภาพของช่อง ไม่ใช่พื้นที่จริงบนพื้น ใช้ตรวจผลจากมุมกล้องและตำแหน่งฉาย ไม่ได้ตัดสินว่า mask คือพื้นที่รถบนพื้น และไม่เปลี่ยนสถานะช่อง</p>
  </section>;
}
