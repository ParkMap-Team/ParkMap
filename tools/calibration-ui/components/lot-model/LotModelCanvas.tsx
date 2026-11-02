'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, MousePointer2, Move, ZoomIn, ZoomOut } from 'lucide-react';
import { LANDMARK_COLORS, LANDMARK_NAMES, modelBounds, moveLandmark, moveVertex, roiObjects, replaceEditorObject, isRoiId } from '../../lib/lotModelEditor';
import type { LotModelDefinition, MetricPoint, MetricPolygon } from '../../types/lotModel';

interface Props {
  model: LotModelDefinition;
  selectedId: string | null;
  disabled: boolean;
  editRoi: boolean;
  onSelect: (id: string | null) => void;
  onPreview: (model: LotModelDefinition) => void;
  onCommit: (before: LotModelDefinition, after: LotModelDefinition) => void;
}

interface View { x: number; y: number; width: number; height: number }
type Drag = { mode: 'pan'; view: View; clientX: number; clientY: number; scale: number }
  | { mode: 'move' | 'vertex'; model: LotModelDefinition; id: string; start: MetricPoint; ring?: number; vertex?: number };

function fit(model: LotModelDefinition): View {
  const bounds = modelBounds(model);
  const padding = Math.max(2, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.06);
  return { x: bounds.minX - padding, y: -bounds.maxY - padding,
    width: Math.max(8, bounds.maxX - bounds.minX) + padding * 2, height: Math.max(8, bounds.maxY - bounds.minY) + padding * 2 };
}

function path(polygon: MetricPolygon) {
  return polygon.map((ring) => `M ${ring.map((p) => `${p.x_m},${-p.y_m}`).join(' L ')} Z`).join(' ');
}

export function LotModelCanvas({ model, selectedId, disabled, editRoi, onSelect, onPreview, onCommit }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastPreview = useRef<LotModelDefinition | null>(null);
  const outline = useRef(model.outline);
  const [view, setView] = useState(() => fit(model));
  const [panMode, setPanMode] = useState(false);
  const rois = roiObjects(model);
  const selected = [...(model.landmarks ?? []), ...(editRoi ? rois : [])].find((landmark) => landmark.landmark_id === selectedId);
  const button = 'rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40';

  useEffect(() => {
    if (outline.current !== model.outline) { outline.current = model.outline; setView(fit(model)); }
  }, [model]);

  function zoom(factor: number) {
    setView((current) => {
      const width = current.width * factor, height = current.height * factor;
      if (Math.min(width, height) < 2 || Math.max(width, height) > 5000) return current;
      return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height };
    });
  }

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) => {
        const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
        const width = current.width * factor, height = current.height * factor;
        if (Math.min(width, height) < 2 || Math.max(width, height) > 5000) return current;
        return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  function modelPoint(event: ReactPointerEvent): MetricPoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !svg.current) return null;
    const point = svg.current.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x_m: transformed.x, y_m: -transformed.y };
  }

  function startPan(event: ReactPointerEvent) {
    event.preventDefault();
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = { mode: 'pan', view, clientX: event.clientX, clientY: event.clientY, scale: 1 / matrix.a };
  }

  function startEdit(event: ReactPointerEvent, id: string, ring?: number, vertex?: number) {
    event.stopPropagation();
    if (panMode || event.button === 1 || event.button === 2) { startPan(event); return; }
    if (disabled || event.button !== 0) return;
    const start = modelPoint(event);
    if (!start) return;
    event.preventDefault(); onSelect(id); svg.current?.setPointerCapture(event.pointerId);
    drag.current = { mode: ring === undefined ? 'move' : 'vertex', model, id, start, ring, vertex };
    lastPreview.current = model;
  }

  function move(event: ReactPointerEvent) {
    const current = drag.current;
    if (!current) return;
    if (current.mode === 'pan') {
      setView({ ...current.view, x: current.view.x - (event.clientX - current.clientX) * current.scale,
        y: current.view.y - (event.clientY - current.clientY) * current.scale });
      return;
    }
    const point = modelPoint(event);
    if (!point) return;
    const object = [...(current.model.landmarks ?? []), ...roiObjects(current.model)].find((item) => item.landmark_id === current.id);
    if (!object) return;
    const edited = current.mode === 'vertex' ? moveVertex(object, current.ring!, current.vertex!, point)
      : moveLandmark(object, { x_m: object.position.x_m + point.x_m - current.start.x_m,
        y_m: object.position.y_m + point.y_m - current.start.y_m });
    const next = replaceEditorObject(current.model, edited);
    lastPreview.current = next; onPreview(next);
  }

  function finish(event: ReactPointerEvent) {
    const current = drag.current;
    if (current && current.mode !== 'pan' && lastPreview.current) onCommit(current.model, lastPreview.current);
    drag.current = null; lastPreview.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  }

  function focusSelection() {
    if (!selected) return;
    const bounds = modelBounds({ ...model, outline: [[selected.position, selected.position, selected.position]], parking_areas: [], landmarks: [selected] });
    const size = Math.max(8, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 5;
    setView({ x: (bounds.minX + bounds.maxX) / 2 - size / 2, y: -(bounds.minY + bounds.maxY) / 2 - size / 2, width: size, height: size });
  }

  const step = Math.max(view.width, view.height) > 100 ? 5 : Math.max(view.width, view.height) > 35 ? 2 : 1;
  const handleRadius = Math.max(view.width, view.height) / 150;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="แผนผังสองมิติ">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
      <div className="flex gap-1">
        <button type="button" className={`${button} ${!panMode ? 'border-blue-400 text-blue-700' : ''}`} aria-label="เลือกและย้ายวัตถุ" aria-pressed={!panMode} onClick={() => setPanMode(false)}><MousePointer2 size={17} /></button>
        <button type="button" className={`${button} ${panMode ? 'border-blue-400 text-blue-700' : ''}`} aria-label="เลื่อนมุมมอง" aria-pressed={panMode} onClick={() => setPanMode(true)}><Move size={17} /></button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={button} aria-label="ซูมเข้า" onClick={() => zoom(0.8)}><ZoomIn size={17} /></button>
        <button type="button" className={button} aria-label="ซูมออก" onClick={() => zoom(1.25)}><ZoomOut size={17} /></button>
        <button type="button" className={button} aria-label="แสดงทั้งหมด" onClick={() => setView(fit(model))}><Maximize2 size={17} /></button>
        <button type="button" className={`${button} text-xs`} disabled={!selected} onClick={focusSelection}>ดูที่เลือก</button>
      </div>
    </div>
    {/* ARIA application is intentional for this drawing surface; keyboard editing and a labelled HTML object list are provided. */}
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    <svg ref={svg} role="application" tabIndex={0} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} className={`h-[560px] w-full bg-[#f8f9fb] ${panMode ? 'cursor-grab' : ''}`}
      style={{ touchAction: 'none' }} aria-label="ลากวัตถุหรือจุดมุม ลูกศรขยับวัตถุทีละ 0.1 เมตร กด Shift เพื่อขยับ 1 เมตร"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { onSelect(null); return; }
        if (disabled || !selected || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const step = event.shiftKey ? 1 : 0.1;
        const position = { x_m: selected.position.x_m + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
          y_m: selected.position.y_m + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) };
        onCommit(model, replaceEditorObject(model, moveLandmark(selected, position)));
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => { if (panMode || event.button === 1 || event.button === 2) startPan(event); else onSelect(null); }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <defs><pattern id="lot-editor-grid" width={step} height={step} patternUnits="userSpaceOnUse"><path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="#dbe1e9" strokeWidth={0.6} vectorEffect="non-scaling-stroke" /></pattern></defs>
      <rect x={view.x - view.width} y={view.y - view.height} width={view.width * 3} height={view.height * 3} fill="url(#lot-editor-grid)" />
      <path d={path(model.outline)} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {(model.landmarks ?? []).map((landmark) => <g key={landmark.landmark_id} onPointerDown={(event) => startEdit(event, landmark.landmark_id)}
        className={disabled ? '' : 'cursor-move'} data-landmark-id={landmark.landmark_id}>
        {landmark.polygon ? <path d={path(landmark.polygon)} fill={LANDMARK_COLORS[landmark.kind]} fillRule="evenodd" stroke={selectedId === landmark.landmark_id ? '#2563eb' : '#fff'} strokeWidth={selectedId === landmark.landmark_id ? 3 : 1} vectorEffect="non-scaling-stroke" />
          : landmark.line ? <polyline points={landmark.line.map((p) => `${p.x_m},${-p.y_m}`).join(' ')} fill="none" stroke={selectedId === landmark.landmark_id ? '#2563eb' : LANDMARK_COLORS[landmark.kind]} strokeWidth={5} vectorEffect="non-scaling-stroke" />
            : <circle cx={landmark.position.x_m} cy={-landmark.position.y_m} r={landmark.radius_m ?? handleRadius * 1.2} fill={LANDMARK_COLORS[landmark.kind]}
              stroke={selectedId === landmark.landmark_id ? '#2563eb' : '#fff'} strokeWidth={selectedId === landmark.landmark_id ? 3 : 1} vectorEffect="non-scaling-stroke" />}
        {(landmark.name || selectedId === landmark.landmark_id) && <text x={landmark.position.x_m} y={-landmark.position.y_m - (landmark.radius_m ?? 0) - handleRadius * 1.5}
          fontSize={handleRadius * 2} textAnchor="middle" fill="#334155" stroke="#fff" strokeWidth={handleRadius * 0.3} paintOrder="stroke" pointerEvents="none">{landmark.name || LANDMARK_NAMES[landmark.kind]}</text>}
      </g>)}
      {rois.map((roi) => <path key={roi.landmark_id} d={path(roi.polygon!)} fill="#dbeafe" fillOpacity={0.35}
        stroke={selectedId === roi.landmark_id ? '#2563eb' : '#60a5fa'} strokeWidth={selectedId === roi.landmark_id ? 3 : 2}
        strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents={editRoi ? 'all' : 'none'}
        className={editRoi && !disabled ? 'cursor-move' : ''} onPointerDown={(event) => { if (editRoi) startEdit(event, roi.landmark_id); }} />)}
      {selected?.polygon?.map((ring, ringIndex) => ring.map((point, vertexIndex) => <circle key={`${ringIndex}-${vertexIndex}`} cx={point.x_m} cy={-point.y_m} r={handleRadius}
        fill="#fff" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-crosshair"
        aria-label={`จุดมุม ${vertexIndex + 1}`} onPointerDown={(event) => startEdit(event, selected.landmark_id, ringIndex, vertexIndex)} />))}
    </svg>
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
      <span>กริดช่องละ {step} เมตรในโมเดล</span><span>+X ไปขวา · +Y ขึ้นบน</span><span>เส้นประฟ้า = ROI {editRoi ? '(แก้ไขได้)' : '(เปิดโหมดแก้ ROI เพื่อปรับ)'}</span>
      {isRoiId(selectedId) && <span>ลากกรอบเพื่อย้าย · ลากจุดเพื่อปรับมุม · หมุนจากช่ององศาด้านขวา</span>}
    </div>
  </section>;
}
