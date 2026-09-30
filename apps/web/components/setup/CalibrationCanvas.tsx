'use client';

import { useRef, useState } from 'react';
import type { CalibrationPoint } from '@/types/calibration';

export interface CalibrationShape { id: string; label: string; points: CalibrationPoint[]; }

export function CalibrationCanvas({ imageUrl, imageWidth, imageHeight, shapes, activeIndex, onChange }: { imageUrl: string; imageWidth: number; imageHeight: number; shapes: CalibrationShape[]; activeIndex: number; onChange: (points: CalibrationPoint[]) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const active = shapes[activeIndex];
  const point = (clientX: number, clientY: number) => {
    const bounds = svgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)) };
  };
  return <div className="flex min-h-96 items-center justify-center overflow-auto rounded-xl bg-slate-950 p-2"><div className="relative inline-block max-h-full max-w-full select-none"><img src={imageUrl} alt="Parking setup reference" draggable={false} className="block max-h-[70vh] max-w-full object-contain" /><svg ref={svgRef} viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="none" className="absolute inset-0 size-full cursor-crosshair touch-none" aria-label={`Draw ${active.label}`} onPointerDown={(event) => { if (event.button === 0 && event.target === event.currentTarget) onChange([...active.points, point(event.clientX, event.clientY)]); }} onPointerMove={(event) => { if (dragging === null) return; const next = [...active.points]; next[dragging] = point(event.clientX, event.clientY); onChange(next); }} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>{shapes.map((shape, shapeIndex) => { const points = shape.points.map((item) => `${item.x * imageWidth},${item.y * imageHeight}`).join(' '); const selected = shapeIndex === activeIndex; return <g key={shape.id} className={selected ? 'text-cyan-300' : shapeIndex === 0 ? 'text-blue-400' : 'text-amber-300'}>{shape.points.length >= 3 ? <polygon points={points} className="pointer-events-none fill-current/10 stroke-current" strokeWidth={Math.max(imageWidth, imageHeight) * (selected ? .003 : .002)} /> : <polyline points={points} fill="none" className="pointer-events-none stroke-current" strokeWidth={Math.max(imageWidth, imageHeight) * .003} />}{shape.points[0] && <text x={shape.points[0].x * imageWidth} y={Math.max(24, shape.points[0].y * imageHeight - 12)} className="pointer-events-none fill-current font-semibold" fontSize={Math.max(18, imageHeight * .022)}>{shape.label}</text>}{shape.points.map((item, index) => <circle key={index} cx={item.x * imageWidth} cy={item.y * imageHeight} r={Math.max(8, Math.max(imageWidth, imageHeight) * (selected ? .006 : .004))} className={selected ? 'cursor-grab fill-white stroke-cyan-400' : 'pointer-events-none fill-current stroke-slate-950'} strokeWidth={Math.max(3, Math.max(imageWidth, imageHeight) * .002)} onPointerDown={selected ? (event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(index); } : undefined} />)}</g>; })}</svg></div></div>;
}
