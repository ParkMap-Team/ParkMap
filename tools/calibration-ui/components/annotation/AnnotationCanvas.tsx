'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { annotationUrl, boxFromPoints, moveBox, type AnnotationSample, type LabelPoint, type MotorcycleLabel } from '../../lib/annotationEditor';

type Mode = 'draw' | 'select' | 'pan';
interface View { x: number; y: number; width: number; height: number }
type Drag = { start: LabelPoint; before: MotorcycleLabel[]; id: string | null; corner?: LabelPoint; view?: View };

function CornerHandles({ label, width, height, radius, onStart }: {
  label: MotorcycleLabel; width: number; height: number; radius: number;
  onStart: (event: PointerEvent, id: string, opposite: LabelPoint) => void;
}) {
  return <>{[[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => <circle key={`${x}-${y}`}
    cx={(label.bbox.x + x * label.bbox.width) * width} cy={(label.bbox.y + y * label.bbox.height) * height}
    r={radius / 1.5} fill="white" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-crosshair"
    onPointerDown={(event) => onStart(event, label.id, { x: label.bbox.x + (1 - x) * label.bbox.width, y: label.bbox.y + (1 - y) * label.bbox.height })} />)}</>;
}

export function AnnotationCanvas({ sample, dataset, disabled, selectedId, onSelect, onChange }: {
  sample: AnnotationSample; dataset: string; disabled: boolean; selectedId: string | null;
  onSelect: (id: string | null) => void; onChange: (labels: MotorcycleLabel[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [mode, setMode] = useState<Mode>('draw');
  const initial = { x: 0, y: 0, width: sample.width, height: sample.height };
  const [view, setView] = useState<View>(initial);
  const radius = Math.max(view.width, view.height) / 130;
  const selected = sample.annotations.find((item) => item.id === selectedId);
  const button = 'rounded-lg border bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-40';
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const width = v.width * factor, height = v.height * factor;
        return width < sample.width / 20 || width > sample.width * 4 ? v
          : { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [sample.width]);
  function point(event: PointerEvent): LabelPoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !svg.current) return null;
    const p = svg.current.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const q = p.matrixTransform(matrix.inverse());
    return { x: q.x / sample.width, y: q.y / sample.height };
  }
  function start(event: PointerEvent, id: string | null = null, corner?: LabelPoint) {
    event.stopPropagation();
    if (disabled || event.button !== 0) return;
    const p = point(event); if (!p) return;
    event.preventDefault();
    if (mode === 'pan') { drag.current = { start: p, before: sample.annotations, id, view }; }
    else if (id && (mode === 'select' || corner)) { onSelect(id); drag.current = { start: p, before: sample.annotations, id, corner }; }
    else if (mode === 'draw') {
      const newId = crypto.randomUUID();
      onSelect(newId); drag.current = { start: p, before: sample.annotations, id: newId };
    } else { onSelect(null); return; }
    svg.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = drag.current, p = point(event); if (!d || !p) return;
    if (d.view) {
      // Convert the live SVG point back through the initial view to avoid pan feedback.
      setView((v) => ({ ...v, x: v.x - (p.x - d.start.x) * sample.width, y: v.y - (p.y - d.start.y) * sample.height }));
      return;
    }
    const existing = d.before.find((label) => label.id === d.id);
    if (existing) {
      const bbox = d.corner ? boxFromPoints(d.corner, p) : moveBox(existing.bbox, p.x - d.start.x, p.y - d.start.y);
      if (bbox.width * sample.width >= 2 && bbox.height * sample.height >= 2) onChange(d.before.map((label) => label.id === d.id ? { ...label, bbox } : label));
    } else {
      const bbox = boxFromPoints(d.start, p);
      if (bbox.width * sample.width >= 2 && bbox.height * sample.height >= 2) onChange([...d.before, { id: d.id!, bbox, occluded: false }]);
    }
  }
  function finish(event: PointerEvent) {
    drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  }
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      {([['draw', 'วาดกรอบ'], ['select', 'เลือก/ย้าย'], ['pan', 'เลื่อนภาพ']] as const).map(([value, name]) =>
        <button type="button" key={value} disabled={disabled} aria-pressed={mode === value} onClick={() => setMode(value)} className={`${button} ${mode === value ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}>{name}</button>)}
      <button type="button" className={button} onClick={() => setView(initial)}>พอดีภาพ</button>
      <span className="text-xs text-slate-500">ล้อเมาส์เพื่อซูม · ลากมุมกรอบเพื่อปรับขนาด</span>
    </div>
    {/* A keyboard-operable custom drawing application; equivalent labelled controls are also provided in the side panel. */}
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    <svg ref={svg} role="application" tabIndex={0} aria-label="วาดกรอบรถ เลือกกรอบแล้วกด Delete เพื่อลบ หรือลูกศรเพื่อย้าย" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      className="h-[610px] w-full bg-slate-900" style={{ touchAction: 'none' }}
      onPointerDown={(event) => start(event)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onKeyDown={(event) => {
        if (disabled || !selected) return;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onChange(sample.annotations.filter((label) => label.id !== selected.id)); onSelect(null); }
        else if (event.key.startsWith('Arrow')) {
          event.preventDefault(); const step = event.shiftKey ? 10 : 1;
          const bbox = moveBox(selected.bbox, (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) / sample.width,
            (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) / sample.height);
          onChange(sample.annotations.map((label) => label.id === selected.id ? { ...label, bbox } : label));
        }
      }}>
      <image href={annotationUrl(dataset, 'image', sample.id)} x={0} y={0} width={sample.width} height={sample.height} />
      {sample.annotations.map((label, index) => <g key={label.id} onPointerDown={(event) => start(event, label.id)} className="cursor-move">
        <rect x={label.bbox.x * sample.width} y={label.bbox.y * sample.height} width={label.bbox.width * sample.width} height={label.bbox.height * sample.height}
          fill={selectedId === label.id ? '#3b82f622' : 'transparent'} stroke={label.occluded ? '#fbbf24' : '#34d399'} strokeWidth={selectedId === label.id ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        <text x={label.bbox.x * sample.width} y={label.bbox.y * sample.height - radius / 2} fontSize={radius * 1.5} fill="white" stroke="black" strokeWidth={radius / 10} paintOrder="stroke">{index + 1}</text>
      </g>)}
      {selected && <CornerHandles label={selected} width={sample.width} height={sample.height} radius={radius} onStart={start} />}
    </svg>
  </section>;
}
