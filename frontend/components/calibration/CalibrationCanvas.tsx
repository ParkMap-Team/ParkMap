'use client';

import { useRef, useState } from 'react';
import type { CalibrationPoint } from '@/types/calibration';
import type { Detection } from '@/types/detection';

export interface CalibrationShape {
  id: string;
  label: string;
  points: CalibrationPoint[];
}

export function CalibrationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  shapes,
  activeIndex,
  detections,
  showDetections,
  onChangeActive,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  shapes: CalibrationShape[];
  activeIndex: number;
  detections: Detection[];
  showDetections: boolean;
  onChangeActive: (points: CalibrationPoint[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<number | null>(null);
  const activePoints = shapes[activeIndex].points;

  const normalizedPoint = (clientX: number, clientY: number): CalibrationPoint => {
    const bounds = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height)),
    };
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-slate-950 p-1 sm:p-2">
      <div className="relative inline-block max-h-full max-w-full select-none">
        <img src={imageUrl} alt="Parking calibration reference" draggable={false} className="block max-h-[calc(100dvh-9rem)] max-w-full object-contain" />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          aria-label={`Draw ${shapes[activeIndex].label}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return;
            onChangeActive([...activePoints, normalizedPoint(event.clientX, event.clientY)]);
          }}
          onPointerMove={(event) => {
            if (draggingVertex === null) return;
            const next = [...activePoints];
            next[draggingVertex] = normalizedPoint(event.clientX, event.clientY);
            onChangeActive(next);
          }}
          onPointerUp={() => setDraggingVertex(null)}
          onPointerCancel={() => setDraggingVertex(null)}
        >
          {showDetections && detections.map((detection, index) => (
            <rect
              key={`detection-${index}`}
              x={detection.bbox.x * imageWidth}
              y={detection.bbox.y * imageHeight}
              width={detection.bbox.width * imageWidth}
              height={detection.bbox.height * imageHeight}
              className="pointer-events-none fill-rose-500/5 stroke-rose-400"
              strokeWidth={Math.max(imageWidth, imageHeight) * 0.002}
            />
          ))}
          {shapes.map((shape, shapeIndex) => {
            const points = shape.points.map((point) => `${point.x * imageWidth},${point.y * imageHeight}`).join(' ');
            const active = shapeIndex === activeIndex;
            return (
              <g key={shape.id} className={active ? 'text-cyan-300' : shapeIndex === 0 ? 'text-blue-400' : 'text-amber-300'}>
                {shape.points.length >= 3
                  ? <polygon points={points} className="pointer-events-none fill-current/10 stroke-current" strokeWidth={Math.max(imageWidth, imageHeight) * (active ? 0.003 : 0.002)} />
                  : <polyline points={points} fill="none" className="pointer-events-none stroke-current" strokeWidth={Math.max(imageWidth, imageHeight) * 0.003} />}
                {shape.points[0] && <text x={shape.points[0].x * imageWidth} y={Math.max(24, shape.points[0].y * imageHeight - 12)} className="pointer-events-none fill-current font-semibold" fontSize={Math.max(18, imageHeight * 0.022)}>{shape.label}</text>}
                {shape.points.map((point, pointIndex) => (
                  <circle
                    key={`${shape.id}-${pointIndex}`}
                    cx={point.x * imageWidth}
                    cy={point.y * imageHeight}
                    r={Math.max(8, Math.max(imageWidth, imageHeight) * (active ? 0.006 : 0.004))}
                    className={active ? 'cursor-grab fill-white stroke-cyan-400 active:cursor-grabbing' : 'pointer-events-none fill-current stroke-slate-950'}
                    strokeWidth={Math.max(3, Math.max(imageWidth, imageHeight) * 0.002)}
                    onPointerDown={active ? (event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDraggingVertex(pointIndex);
                    } : undefined}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
