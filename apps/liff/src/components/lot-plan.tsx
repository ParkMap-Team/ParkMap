"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { LotLandmark, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import { type Size, type View2D, fromScreen, overview2D, pan2D, toScreen, zoom2D } from "@/lib/map/camera";
import { axisHeading } from "@/lib/map/geometry";
import { MOTORCYCLE_MODEL } from "@/lib/map/motorcycle-model";
import { COLORS } from "@/lib/parking/presentation";
import { LabelLayer, type LabelLayerHandle, MAP_INSETS, type MapViewProps } from "./map-overlay";

// The 2D plan: the same lot model and API polygons as the 3D scene, drawn top-down in SVG with the
// far (+y) side at the top. It is the fallback when 3D is unavailable and a choice people can make.

const TAP_SLOP_PX = 8;

function pathOf(view: View2D, size: Size, polygon: MetricPolygon): string {
  return polygon.map((ring) => `M${ring.map((point) => toScreen(view, size, point).join(",")).join("L")}Z`).join("");
}

/** A generic top-down motorcycle in model metres (length along +x), drawn over its red footprint. */
function MotorcycleIcon({ proxy, view, size }: { proxy: MotorcycleProxy; view: View2D; size: Size }) {
  const [x, y] = toScreen(view, size, proxy.center);
  const sx = (proxy.length_m / MOTORCYCLE_MODEL.lengthM) * view.pxPerM;
  const sy = (proxy.width_m / MOTORCYCLE_MODEL.widthM) * view.pxPerM;
  const degrees = (-axisHeading(proxy.heading_rad) * 180) / Math.PI;
  return (
    <g transform={`translate(${x},${y}) rotate(${degrees}) scale(${sx},${sy})`}>
      <rect x={-0.9} y={-0.06} width={0.56} height={0.12} rx={0.05} fill="#1f2937" />
      <rect x={0.37} y={-0.06} width={0.56} height={0.12} rx={0.05} fill="#1f2937" />
      <rect x={-0.78} y={-0.17} width={1.24} height={0.34} rx={0.12} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.03} />
      <rect x={-0.7} y={-0.13} width={0.6} height={0.26} rx={0.08} fill="#374151" />
      <rect x={0.48} y={-0.34} width={0.07} height={0.68} rx={0.03} fill="#6b7280" />
    </g>
  );
}

function LandmarkShape({ landmark, view, size }: { landmark: LotLandmark; view: View2D; size: Size }) {
  if (landmark.polygon) {
    const fill = landmark.kind === "GUARD_BOOTH" ? COLORS.GUARD_BOOTH : landmark.kind === "AISLE" ? COLORS.AISLE : COLORS.BUILDING;
    return <path d={pathOf(view, size, landmark.polygon)} fill={fill} fillOpacity={landmark.kind === "AISLE" ? 1 : 0.85} stroke="#ffffff" strokeWidth={1.5} fillRule="evenodd" />;
  }
  if (landmark.line) {
    const points = landmark.line.map((point) => toScreen(view, size, point).join(",")).join(" ");
    return <polyline points={points} fill="none" stroke={COLORS.BARRIER} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (landmark.kind === "ENTRANCE" || landmark.kind === "EXIT" || landmark.kind === "ENTRANCE_EXIT" || landmark.kind === "GUARD_BOOTH") {
    const [x, y] = toScreen(view, size, landmark.position);
    return <circle cx={x} cy={y} r={4} fill={landmark.kind === "EXIT" ? COLORS.EXIT : landmark.kind === "GUARD_BOOTH" ? COLORS.GUARD_BOOTH : COLORS.ENTRANCE} stroke="#fff" strokeWidth={2} />;
  }
  return null;
}

export default function LotPlan({ map, labels, selection, onSelect, ref }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<LabelLayerHandle>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View2D | null>(null);
  const overview = useRef<View2D | null>(null);
  const atOverview = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null });
  // Read inside the resize observer without re-subscribing on every poll.
  const latestBounds = useRef(map.bounds);
  latestBounds.current = map.bounds;

  // Fit on first layout and whenever the map is resized, for example when the panel opens: the
  // overview is refitted. Once people have moved the view, neither a resize nor new data moves it.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (next.width === 0 || next.height === 0) return;
      setSize(next);
      overview.current = overview2D(latestBounds.current, { ...next, insets: MAP_INSETS });
      setView((current) => (!current || atOverview.current ? overview.current : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map.outline]);

  const zoomAt = useCallback(
    (factor: number, anchor?: [number, number]) => {
      if (!size || !overview.current) return;
      atOverview.current = false;
      setView((current) => current && zoom2D(current, overview.current!.pxPerM, factor, size, anchor ?? [size.width / 2, size.height / 2], map.bounds));
    },
    [size, map.bounds],
  );

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => zoomAt(factor),
    reset() {
      atOverview.current = true;
      setView(overview.current);
    },
    focus(point) {
      if (!overview.current) return;
      atOverview.current = false;
      setView((current) => ({ center: point, pxPerM: Math.max(current?.pxPerM ?? 0, overview.current!.pxPerM * 2) }));
    },
    panBy(dx, dy) {
      atOverview.current = false;
      setView((current) => current && pan2D(current, dx, dy, map.bounds));
    },
  }));

  useLayoutEffect(() => {
    if (!view || !size || !overview.current) return;
    labelLayer.current?.update((point) => toScreen(view, size, point), size, view.pxPerM / overview.current.pxPerM);
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // A non-passive listener so the page does not scroll while the wheel zooms the map.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, [event.clientX - rect.left, event.clientY - rect.top]);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function local(event: React.PointerEvent): { x: number; y: number } {
    const rect = container.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: null };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onPointerMove(event: React.PointerEvent) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || !size) return;
    const next = local(event);
    pointers.current.set(event.pointerId, next);
    gesture.current.moved += Math.hypot(next.x - previous.x, next.y - previous.y);
    if (gesture.current.moved <= TAP_SLOP_PX) return;
    atOverview.current = false;
    if (pointers.current.size === 1) {
      setView((current) => current && pan2D(current, next.x - previous.x, next.y - previous.y, map.bounds));
    } else if (pointers.current.size === 2 && gesture.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(distance / gesture.current.pinch, [(a.x + b.x) / 2, (a.y + b.y) / 2]);
      gesture.current.pinch = distance;
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    const wasTap = pointers.current.size === 1 && gesture.current.moved <= TAP_SLOP_PX;
    pointers.current.delete(event.pointerId);
    if (wasTap && view && size) {
      const { x, y } = local(event);
      onSelect(fromScreen(view, size, x, y));
    }
  }

  return (
    <div
      ref={container}
      className="relative size-full touch-none overflow-hidden"
      style={{ backgroundColor: "#f8fafc" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
    >
      {view && size && (
        <svg width={size.width} height={size.height} className="absolute inset-0" aria-hidden>
          <defs>
            <pattern id="plan-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={8} height={8} fill={COLORS.UNKNOWN} />
              <rect width={3} height={8} fill={COLORS.UNKNOWN_HATCH} />
            </pattern>
            <pattern id="plan-dots" width={8} height={8} patternUnits="userSpaceOnUse">
              <rect width={8} height={8} fill={COLORS.UNMONITORED} />
              <circle cx={4} cy={4} r={1.4} fill={COLORS.UNMONITORED_DOT} />
            </pattern>
          </defs>
          <path d={pathOf(view, size, map.outline)} fill={COLORS.LOT} fillRule="evenodd" />
          {map.unmonitored.map((polygon, index) => (
            <path key={index} d={pathOf(view, size, polygon)} fill="url(#plan-dots)" fillRule="evenodd" />
          ))}
          {map.landmarks.map((landmark) => landmark.polygon && <LandmarkShape key={landmark.landmark_id} landmark={landmark} view={view} size={size} />)}
          {map.areas.map((area) => (
            <g key={area.parkingAreaId}>
              <path
                d={pathOf(view, size, area.polygon)}
                fill={area.unknownReason ? "url(#plan-hatch)" : COLORS.PARKING_AREA}
                stroke={COLORS.PARKING_AREA_STROKE}
                strokeWidth={1}
                fillRule="evenodd"
              />
              {area.regions.map((region, index) => (
                <path
                  key={index}
                  d={pathOf(view, size, region.polygon)}
                  fill={region.kind === "UNKNOWN" ? "url(#plan-hatch)" : COLORS[region.kind]}
                  fillOpacity={region.kind === "UNKNOWN" ? 1 : 0.9}
                  stroke={region.kind === "AVAILABLE" ? COLORS.AVAILABLE_STROKE : region.kind === "ALMOST_AVAILABLE" ? COLORS.ALMOST_AVAILABLE_STROKE : COLORS.UNKNOWN_HATCH}
                  strokeWidth={region.kind === "UNKNOWN" ? 1 : 2}
                  strokeDasharray={region.kind === "ALMOST_AVAILABLE" ? "6 4" : undefined}
                  fillRule="evenodd"
                />
              ))}
              {area.motorcycles.map(({ proxy, footprint }) => (
                <g key={proxy.detection_id}>
                  <path d={pathOf(view, size, footprint)} fill={COLORS.OCCUPIED} fillOpacity={0.85} />
                  <MotorcycleIcon proxy={proxy} view={view} size={size} />
                </g>
              ))}
            </g>
          ))}
          {map.landmarks.map((landmark) => !landmark.polygon && <LandmarkShape key={landmark.landmark_id} landmark={landmark} view={view} size={size} />)}
          {selection?.polygon && (
            <g fill="none" strokeLinejoin="round">
              <path d={pathOf(view, size, selection.polygon)} stroke={COLORS.SELECTED_HALO} strokeWidth={6} />
              <path d={pathOf(view, size, selection.polygon)} stroke={COLORS.SELECTED} strokeWidth={3} />
            </g>
          )}
        </svg>
      )}
      <LabelLayer ref={labelLayer} labels={labels} selection={selection} />
    </div>
  );
}

