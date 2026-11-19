"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { LotLandmark, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import {
  FLY_MS,
  NUDGE_MS,
  type Size,
  type View2D,
  centreOn2D,
  clampToBounds,
  easeInOut,
  easeOut,
  fromScreen,
  mix2D,
  overview2D,
  pan2D,
  revealOffset,
  toScreen,
  zoom2D,
} from "@/lib/map/camera";
import { type Flight, fly } from "@/lib/map/flight";
import { axisHeading } from "@/lib/map/geometry";
import { useRouteReveal } from "@/lib/map/use-route-reveal";
import { routeArrow } from "@/lib/map/route-reveal";
import { GROUND_KINDS, landmarkTop } from "@/lib/map/landmark-style";
import { MOTORCYCLE_MODEL } from "@/lib/map/motorcycle-model";
import { COLORS, FREE_SHADOW } from "@/lib/parking/presentation";
import { LabelLayer, type LabelLayerHandle, type MapViewProps } from "./map-overlay";

// The 2D plan: the same lot model and API polygons as the 3D scene, drawn top-down in SVG with the
// far (+y) side at the top. It is the fallback when 3D is unavailable and a choice people can make.
// Footprints and trees are drawn under the parking areas, so status always shows on top. A move
// only changes the view; the drawing always shows the current data.

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

/** Footprints and tree canopies lie under the parking areas; lines and markers sit above them. */
function underAreas(landmark: LotLandmark): boolean {
  return Boolean(landmark.polygon) || landmark.kind === "TREE";
}

function LandmarkShape({ landmark, view, size }: { landmark: LotLandmark; view: View2D; size: Size }) {
  if (landmark.polygon) {
    const ground = GROUND_KINDS.has(landmark.kind) && !landmark.height_m;
    return (
      <path
        d={pathOf(view, size, landmark.polygon)}
        fill={landmarkTop(landmark)}
        stroke={ground ? "none" : "#ffffff"}
        strokeWidth={1.5}
        fillRule="evenodd"
      />
    );
  }
  if (landmark.kind === "TREE" && landmark.radius_m) {
    const [x, y] = toScreen(view, size, landmark.position);
    return <circle cx={x} cy={y} r={landmark.radius_m * view.pxPerM} fill={COLORS.TREE_CANOPY} fillOpacity={0.85} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={1} />;
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

export default function LotPlan({ map, labels, selection, route, routeReplay, heldPolygons, plain, markers, overviewKey, onSelect, insets, callout, ref }: MapViewProps) {
  const { visibleRoute, revealing } = useRouteReveal(route, routeReplay);
  const visibleSelection = revealing && selection?.destination ? null : selection;
  const container = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<LabelLayerHandle>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View2D | null>(null);
  const overview = useRef<View2D | null>(null);
  const previousOverviewKey = useRef(overviewKey);
  const atOverview = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null });
  // The view on screen, for a move to start from even while another is under way.
  const shown = useRef<View2D | null>(null);
  shown.current = view;
  const flight = useRef<Flight | null>(null);

  // Fit on first layout and whenever the map or what covers it changes size: the overview is
  // refitted. Once people have moved the view, neither a resize nor new data moves it.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (next.width > 0 && next.height > 0) setSize(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stop = useCallback(() => flight.current?.cancel(), []);

  /** Glides from the view on screen to `target`, or jumps there when `ms` is 0. */
  const moveTo = useCallback((target: View2D, ms: number, ease: (t: number) => number) => {
    const from = shown.current;
    flight.current?.cancel();
    if (!from) return;
    flight.current = fly(ms, ease, (t) => setView(mix2D(from, target, t)));
  }, []);

  // Plain numbers, so a poll that rebuilds the map with the same geometry does not refit.
  const { minX, minY, maxX, maxY } = map.frame;
  const { top, right, bottom, left } = insets;
  useLayoutEffect(() => {
    if (!size) return;
    const next = overview2D({ minX, minY, maxX, maxY }, { ...size, insets: { top, right, bottom, left } });
    overview.current = next;
    const changedOverview = previousOverviewKey.current !== overviewKey;
    previousOverviewKey.current = overviewKey;
    if (changedOverview && shown.current) {
      atOverview.current = true;
      moveTo(next, FLY_MS, easeInOut);
    } else if (!shown.current || atOverview.current) {
      flight.current?.cancel();
      setView(next);
    }
  }, [size, minX, minY, maxX, maxY, top, right, bottom, left, overviewKey, moveTo]);

  const zoomAt = useCallback(
    (factor: number, anchor?: [number, number], ms = 0) => {
      const from = shown.current;
      if (!size || !overview.current || !from) return;
      atOverview.current = false;
      moveTo(zoom2D(from, overview.current.pxPerM, factor, size, anchor ?? [size.width / 2, size.height / 2], map.bounds), ms, easeOut);
    },
    [size, map.bounds, moveTo],
  );

  useImperativeHandle(ref, () => ({
    zoomBy: (factor, animated) => zoomAt(factor, undefined, animated ? NUDGE_MS : 0),
    reset(animated) {
      if (!overview.current) return;
      atOverview.current = true;
      moveTo(overview.current, animated ? FLY_MS : 0, easeInOut);
    },
    focus(point) {
      if (!overview.current || !size || !shown.current) return;
      atOverview.current = false;
      const target = centreOn2D(point, Math.max(shown.current.pxPerM, overview.current.pxPerM * 2), { ...size, insets });
      moveTo({ ...target, center: clampToBounds(target.center, map.bounds) }, FLY_MS, easeInOut);
    },
    panBy(dx, dy) {
      if (!shown.current) return;
      atOverview.current = false;
      moveTo(pan2D(shown.current, dx, dy, map.bounds), 0, easeOut);
    },
    reveal(point, cover) {
      if (!size || !shown.current || flight.current?.active) return;
      const offset = revealOffset(toScreen(shown.current, size, point)[1], size.height, insets.top, cover);
      if (offset === 0) return;
      atOverview.current = false;
      moveTo(pan2D(shown.current, 0, offset, map.bounds), NUDGE_MS, easeOut);
    },
  }));

  useEffect(() => stop, [stop]);

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
    // A finger on the map takes over from any move in progress, where the map is now.
    stop();
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

  const routePoints = view && size && visibleRoute?.map((point) => toScreen(view, size, point).join(",")).join(" ");
  const arrowPoints = view && size && revealing && visibleRoute
    ? routeArrow(visibleRoute)?.map((point) => toScreen(view, size, point).join(",")).join(" ")
    : undefined;

  return (
    <div
      ref={container}
      className="relative size-full touch-none overflow-hidden"
      style={{ backgroundColor: COLORS.GROUND }}
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
              <rect width={2} height={8} fill={COLORS.UNKNOWN_HATCH} />
            </pattern>
            <pattern id="plan-dots" width={8} height={8} patternUnits="userSpaceOnUse">
              <rect width={8} height={8} fill={COLORS.UNMONITORED} />
              <circle cx={4} cy={4} r={1.4} fill={COLORS.UNMONITORED_DOT} />
            </pattern>
            <filter id="plan-soft" filterUnits="userSpaceOnUse" x={0} y={0} width={size.width} height={size.height}>
              <feGaussianBlur stdDeviation={FREE_SHADOW.blurM * view.pxPerM} />
            </filter>
          </defs>
          <path d={pathOf(view, size, map.outline)} fill={COLORS.LOT} fillRule="evenodd" />
          {map.unmonitored.map((polygon, index) => (
            <path key={index} d={pathOf(view, size, polygon)} fill="url(#plan-dots)" fillRule="evenodd" />
          ))}
          {map.landmarks.map((landmark) => underAreas(landmark) && <LandmarkShape key={landmark.landmark_id} landmark={landmark} view={view} size={size} />)}
          {map.areas.map((area) => (
            <g key={area.parkingAreaId}>
              <path
                d={pathOf(view, size, area.polygon)}
                fill={area.unknownReason ? "url(#plan-hatch)" : COLORS.PARKING_AREA}
                stroke={COLORS.PARKING_AREA_STROKE}
                strokeWidth={1.5}
                fillRule="evenodd"
              />
              {plain ? (
                // The free cells blur together as one layer, so neither a cell edge nor a seam shows.
                <g opacity={FREE_SHADOW.opacity} filter="url(#plan-soft)">
                  {area.regions.map((region, index) => (
                    <path key={index} d={pathOf(view, size, region.polygon)} fill={FREE_SHADOW.color} stroke={FREE_SHADOW.color} strokeWidth={1} fillRule="evenodd" />
                  ))}
                </g>
              ) : (
                <>
                  {/* The API sends a region as many narrow cells. Their edges go first at double width and
                      the opaque fills over them, so only the outside of a run of cells keeps a thin edge
                      and the map draws no stall lines. */}
                  {area.regions.map((region, index) => (
                    <path
                      key={`edge-${index}`}
                      d={pathOf(view, size, region.polygon)}
                      fill="none"
                      stroke={region.kind === "OCCUPIED" ? COLORS.OCCUPIED : (region.kind === "AVAILABLE" || region.kind === "WIDTH_SUFFICIENT") ? COLORS.AVAILABLE_STROKE : region.kind === "ALMOST_AVAILABLE" ? COLORS.ALMOST_AVAILABLE_STROKE : COLORS.UNKNOWN_HATCH}
                      strokeWidth={region.kind === "UNKNOWN" ? 2 : 3}
                      strokeDasharray={region.kind === "ALMOST_AVAILABLE" ? "6 4" : undefined}
                    />
                  ))}
                  {area.regions.map((region, index) => {
                    const kind = region.kind;
                    const fill = kind === "UNKNOWN" ? "url(#plan-hatch)" : COLORS[kind];
                    return (
                      <path
                        key={`fill-${index}`}
                        d={pathOf(view, size, region.polygon)}
                        fill={fill}
                        // A hairline of the fill closes the anti-aliased seam between two cells.
                        stroke={fill}
                        strokeWidth={1}
                        fillRule="evenodd"
                      />
                    );
                  })}
                </>
              )}
              {area.motorcycles.map(({ proxy, displayProxy, footprint }) => (
                <g key={proxy.detection_id}>
                  {!plain && !area.regions.some(region => region.kind === "OCCUPIED") && <path d={pathOf(view, size, footprint)} fill={COLORS.OCCUPIED} fillOpacity={0.85} />}
                  <MotorcycleIcon proxy={displayProxy} view={view} size={size} />
                </g>
              ))}
            </g>
          ))}
          {map.landmarks.map((landmark) => !underAreas(landmark) && <LandmarkShape key={landmark.landmark_id} landmark={landmark} view={view} size={size} />)}
          {heldPolygons?.map((polygon, index) => (
            <path key={index} d={pathOf(view, size, polygon)} fill={COLORS.HELD} fillRule="evenodd" stroke={COLORS.HELD_STROKE} strokeWidth={2} strokeDasharray="6 4" />
          ))}
          {visibleSelection?.polygon && !heldPolygons?.includes(visibleSelection.polygon) && (
            <g fill="none" strokeLinejoin="round">
              {/* On a rider's plain map the destination is the only ground painted green, as one block. */}
              {plain && visibleSelection.destination && <path d={pathOf(view, size, visibleSelection.polygon)} fill={COLORS.AVAILABLE} fillRule="evenodd" />}
              <path d={pathOf(view, size, visibleSelection.polygon)} stroke={COLORS.SELECTED_HALO} strokeWidth={6} />
              <path d={pathOf(view, size, visibleSelection.polygon)} stroke={visibleSelection.destination ? COLORS.ENTRANCE : COLORS.SELECTED} strokeWidth={3} />
            </g>
          )}
          {markers?.map((marker) => (
            <g key={marker.id} fill="none" strokeLinejoin="round">
              <path d={pathOf(view, size, marker.polygon)} fill={marker.color} fillRule="evenodd" />
              <path d={pathOf(view, size, marker.polygon)} stroke={COLORS.SELECTED_HALO} strokeWidth={6} />
              <path d={pathOf(view, size, marker.polygon)} stroke={marker.color} strokeWidth={3} />
            </g>
          ))}
          {routePoints && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={routePoints} stroke="white" strokeWidth={10} />
              <polyline points={routePoints} stroke={COLORS.ENTRANCE} strokeWidth={6} />
              {arrowPoints && (
                <>
                  <polyline points={arrowPoints} stroke="white" strokeWidth={12} />
                  <polyline points={arrowPoints} stroke={COLORS.ENTRANCE} strokeWidth={7} />
                </>
              )}
            </g>
          )}
          {visibleSelection?.destination && visibleSelection.polygon && (
            <path d={pathOf(view, size, visibleSelection.polygon)} fill="none" stroke="#60a5fa" strokeWidth={14} strokeLinejoin="round" opacity={0} className={routeReplay ? "animate-[parking-arrival_800ms_ease-out]" : "motion-safe:animate-[parking-arrival_800ms_ease-out]"} />
          )}
        </svg>
      )}
      <LabelLayer ref={labelLayer} labels={labels} selection={visibleSelection} markers={markers} insets={insets} callout={callout} />
    </div>
  );
}

