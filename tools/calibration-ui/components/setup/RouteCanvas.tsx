'use client';

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { LANDMARK_COLORS } from '../../lib/lotModelEditor';
import { moveRoutePoint, ROUTE_COLORS, type RouteEditorState, type RoutePlan, type RoutePoint, type RoutePreview } from '../../lib/routeEditor';

type View = { x: number; y: number; width: number; height: number };
const path = (rings: RoutePoint[][]) => rings.map(ring => `M${ring.map(p => `${p.x_m},${-p.y_m}`).join(' L')} Z`).join(' ');
const points = (ring: RoutePoint[]) => ring.map(p => `${p.x_m},${-p.y_m}`).join(' ');

export function RouteCanvas({ state, previews, row, plan, selected, disabled, adding, pending, onSelect, onPreview, onCommit, onDragEnd, onAdd }: {
  state: RouteEditorState; previews: RoutePreview[]; row: string; plan: RoutePlan; selected: number; disabled: boolean; adding: boolean; pending: boolean;
  onSelect: (index: number) => void; onPreview: (plan: RoutePlan) => void; onCommit: (plan: RoutePlan) => void; onDragEnd: (before: RoutePlan) => void; onAdd: (point: RoutePoint) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'point'; index: number; before: RoutePlan } | { kind: 'pan'; view: View; x: number; y: number; scale: number } | null>(null);
  const latest = useRef(plan);
  useLayoutEffect(() => { latest.current = plan; }, [plan]);
  function fit(): View {
    const extra = [...state.lot_model.outline.flat(), ...Object.values(state.configuration.rows).flatMap(r => r.waypoints),
      ...plan.waypoints, ...previews.flatMap(r => r.route), state.entrance];
    const left = Math.min(...extra.map(p => p.x_m)), right = Math.max(...extra.map(p => p.x_m));
    const bottom = Math.min(...extra.map(p => p.y_m)), top = Math.max(...extra.map(p => p.y_m));
    return { x: left - 4, y: -top - 4, width: right - left + 8, height: top - bottom + 8 };
  }
  const [view, setView] = useState(fit);
  const unit = Math.max(view.width, view.height) / 65;
  function zoom(factor: number) {
    setView(v => ({ x: v.x + v.width * (1 - factor) / 2, y: v.y + v.height * (1 - factor) / 2,
      width: Math.max(3, Math.min(3000, v.width * factor)), height: Math.max(3, Math.min(3000, v.height * factor)) }));
  }
  function point(event: ReactPointerEvent): RoutePoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !svg.current) return null;
    const p = svg.current.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const local = p.matrixTransform(matrix.inverse());
    return { x_m: Math.round(local.x * 100) / 100, y_m: Math.round(-local.y * 100) / 100 };
  }
  function startPoint(event: ReactPointerEvent, index: number) {
    event.stopPropagation();
    if (disabled || event.button !== 0) return;
    onSelect(index); svg.current?.setPointerCapture(event.pointerId);
    drag.current = { kind: 'point', index, before: plan };
  }
  function finish(event: ReactPointerEvent, cancel = false) {
    const current = drag.current; drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    if (current?.kind === 'point') {
      if (cancel) onPreview(current.before);
      else if (JSON.stringify(current.before) !== JSON.stringify(latest.current)) onDragEnd(current.before);
    }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-slate-600">{adding ? 'คลิกบนแผนที่เพื่อเพิ่มจุดต่อจากจุดที่เลือก' : 'ลากจุดเลี้ยว · ลากพื้นเพื่อเลื่อนแผนที่ · ปุ่มลูกศรขยับจุด 0.1 ม.'}</p>
      <div className="flex gap-1">
        <button type="button" aria-label="ซูมเข้า" className="rounded border bg-white p-3 hover:bg-slate-50 focus-visible:ring-2" onClick={() => zoom(.8)}><Plus size={18} /></button>
        <button type="button" aria-label="ซูมออก" className="rounded border bg-white p-3 hover:bg-slate-50 focus-visible:ring-2" onClick={() => zoom(1.25)}><Minus size={18} /></button>
        <button type="button" aria-label="ดูเส้นทางทั้งหมด" className="rounded border bg-white p-3 hover:bg-slate-50 focus-visible:ring-2" onClick={() => setView(fit())}><Maximize2 size={18} /></button>
      </div>
    </div>
    <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} aria-label="แผนที่แก้เส้นทาง"
      className={`h-[min(70vh,760px)] min-h-96 w-full touch-none rounded-xl border bg-[#e7e9e3] ${adding ? 'cursor-crosshair' : 'cursor-grab'}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        if (adding && !disabled) { const p = point(event); if (p) onAdd(p); return; }
        const matrix = svg.current?.getScreenCTM(); if (!matrix) return;
        svg.current?.setPointerCapture(event.pointerId);
        drag.current = { kind: 'pan', view, x: event.clientX, y: event.clientY, scale: 1 / matrix.a };
      }} onPointerMove={event => {
        const current = drag.current; if (!current) return;
        if (current.kind === 'pan') setView({ ...current.view, x: current.view.x - (event.clientX - current.x) * current.scale,
          y: current.view.y - (event.clientY - current.y) * current.scale });
        else { const p = point(event); if (p) onPreview(moveRoutePoint(latest.current, current.index, p)); }
      }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
      <g pointerEvents="none">
        {state.lot_model.landmarks?.map(item => item.polygon ? <path key={item.landmark_id} d={path(item.polygon)} fill={LANDMARK_COLORS[item.kind]} stroke="white" vectorEffect="non-scaling-stroke" /> : item.line ? <polyline key={item.landmark_id} points={points(item.line)} fill="none" stroke={LANDMARK_COLORS[item.kind]} strokeWidth={3} vectorEffect="non-scaling-stroke" /> : <circle key={item.landmark_id} cx={item.position.x_m} cy={-item.position.y_m} r={item.radius_m ?? unit * .5} fill={LANDMARK_COLORS[item.kind]} />)}
        {state.lot_model.parking_areas.map(area => <path key={area.parking_area_id} d={path(area.polygon)} fill="#cbd5e1" fillOpacity={.5} stroke="#64748b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
        {previews.map(item => <g key={item.row_id} opacity={pending ? .35 : item.row_id === row ? 1 : .35}>
          <polyline points={points(item.route)} fill="none" stroke="white" strokeWidth={7} vectorEffect="non-scaling-stroke" />
          <polyline points={points(item.route)} fill="none" stroke={ROUTE_COLORS[item.row_id]} strokeWidth={item.row_id === row ? 4 : 2} vectorEffect="non-scaling-stroke" />
          {item.route.at(-1) && <text x={item.route.at(-1)!.x_m} y={-item.route.at(-1)!.y_m - unit} fontSize={unit * 1.6} fontWeight={700} textAnchor="middle" fill={ROUTE_COLORS[item.row_id]} stroke="white" strokeWidth={unit * .25} paintOrder="stroke">{item.label}</text>}
        </g>)}
        <circle cx={state.entrance.x_m} cy={-state.entrance.y_m} r={unit * .65} fill="#2563eb" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <text x={state.entrance.x_m} y={-state.entrance.y_m + unit * 2} fontSize={unit * 1.4} textAnchor="middle" fill="#1e293b">ทางเข้า</text>
      </g>
      {plan.waypoints.map((p, index) => <g key={index} role="button" tabIndex={disabled ? -1 : 0} aria-label={`จุดเลี้ยว ${index + 1}, X ${p.x_m}, Y ${p.y_m}`}
        className="cursor-move outline-none focus-visible:drop-shadow-lg" onPointerDown={event => startPoint(event, index)}
        onKeyDown={event => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index); return; }
          const delta = event.shiftKey ? 1 : .1;
          const shifts: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
          if (shifts[event.key]) { event.preventDefault(); onSelect(index); const [dx, dy] = shifts[event.key]; onCommit(moveRoutePoint(plan, index, { x_m: p.x_m + dx, y_m: p.y_m + dy })); }
        }}>
        <circle cx={p.x_m} cy={-p.y_m} r={unit * 1.5} fill="transparent" />
        <circle cx={p.x_m} cy={-p.y_m} r={unit * .65} fill={selected === index ? ROUTE_COLORS[row] : 'white'} stroke={ROUTE_COLORS[row]} strokeWidth={selected === index ? 4 : 2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <text x={p.x_m} y={-p.y_m + unit * .25} fontSize={unit * .85} textAnchor="middle" fontWeight={700} fill={selected === index ? 'white' : ROUTE_COLORS[row]} pointerEvents="none">{index + 1}</text>
      </g>)}
    </svg>
    <p className="text-xs text-slate-500">จุดต้นทางและจุดกลางแถวเป็นจุดอ้างอิงที่ระบบเชื่อมให้ เส้นนี้ไม่ตรวจสิ่งกีดขวางหรือรับรองว่าขี่ผ่านได้</p>
  </div>;
}
