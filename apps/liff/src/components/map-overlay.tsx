"use client";

import { ArrowUp } from "lucide-react";
import { Component, type ReactNode, type Ref, useImperativeHandle, useRef } from "react";
import type { MetricPoint, MetricPolygon } from "@/lib/api/types";
import type { Insets, Size } from "@/lib/map/camera";
import { LABEL_MIN_ZOOM, LABEL_PRIORITY, type LabelCandidate, type ScreenRect, placeLabels } from "@/lib/map/labels";
import type { MapLabel } from "@/lib/map/legend";
import type { LotMap } from "@/lib/map/lot-map";
import { COLORS } from "@/lib/parking/presentation";

// What the 2D plan and the 3D scene share: the props and handle site-view drives them with, the
// DOM label layer, and an error boundary that turns a failed view into a fallback.

/**
 * Moves from a button glide (`animated`); keyboard steps and drags apply at once. A move cancels
 * the one before it, and touching the map cancels any move.
 */
export type MapViewHandle = {
  zoomBy(factor: number, animated: boolean): void;
  /** The elevated overview of the whole place. */
  reset(animated: boolean): void;
  /** Flies to a point and puts it in the middle of the uncovered map. */
  focus(point: MetricPoint): void;
  panBy(dx: number, dy: number): void;
  /** Turns the map counter-clockwise on screen by `rad`; only the 3D view turns. */
  rotateBy?(rad: number, animated: boolean): void;
  /**
   * Nudges the map just enough that a point sits clear of the controls and of `bottom` pixels of
   * sheet. It does nothing while a fly is under way, so it never fights a move people asked for.
   */
  reveal(point: MetricPoint, bottom: number): void;
};

/** A Guard Booth rider's placement: outlined and pinned in the rider's colour. */
export type MapMarker = { id: string; text: string; color: string; point: MetricPoint; polygon: MetricPolygon };

export type MapViewProps = {
  map: LotMap;
  labels: MapLabel[];
  /** The selected place: its outline in the current data, and where its label sits. */
  selection: { point: MetricPoint; polygon: MetricPolygon | null; text: string; destination?: boolean } | null;
  route?: readonly MetricPoint[];
  routeReplay?: number;
  heldPolygons?: readonly MetricPolygon[];
  markers?: readonly MapMarker[];
  /** Changes when a rider explicitly selects another overview. */
  overviewKey?: string;
  onSelect(point: MetricPoint | null): void;
  /** Map edges covered by controls and the sheet, in pixels: the overview fits inside them. */
  insets: Insets;
  /**
   * Controls that belong to the destination, shown with its pin and only while the pin shows. They
   * are placed when the map moves, so they keep one size whatever they show.
   */
  callout?: ReactNode;
  ref?: Ref<MapViewHandle>;
};

/** Everything outside the free viewport, so labels never hide under the controls or the sheet. */
export function blockedRects({ width, height }: Size, insets: Insets): ScreenRect[] {
  return [
    { x0: 0, y0: 0, x1: width, y1: insets.top },
    { x0: width - insets.right, y0: 0, x1: width, y1: height },
    { x0: 0, y0: height - insets.bottom, x1: width, y1: height },
    { x0: 0, y0: 0, x1: insets.left, y1: height },
  ];
}

export type LabelLayerHandle = {
  /** Positions every label from ground to screen; `project` returns null for points off screen. */
  update(project: (point: MetricPoint) => [number, number] | null, size: Size, zoom: number): void;
};

/** `raised` labels sit just above their point; a `pin` label is a pill of that colour pointing down at it. */
type PlacedLabel = Pick<MapLabel, "id" | "text" | "kind" | "anchor"> & { direction: number | null; raised?: boolean; pin?: string };

/** Height of a pin's point below its badge, which the badge sits above. */
const PIN_POINT_PX = 10;
/** Space between the destination pin and its callout. */
const CALLOUT_GAP_PX = 6;

function Pin({ text, color }: { text: string; color: string }) {
  return (
    <span className="relative flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-lg leading-none font-bold text-white shadow-md ring-[3px] ring-white motion-safe:animate-pin-drop" style={{ backgroundColor: color }}>
      {/* Two pulse rings draw the eye to a pin as it lands. */}
      <span aria-hidden className="absolute inset-0 -z-10 rounded-full opacity-0 motion-safe:animate-pin-ring" style={{ backgroundColor: color }} />
      {text}
      <span aria-hidden className="absolute top-full left-1/2 -translate-x-1/2 border-x-8 border-x-transparent" style={{ borderTopWidth: PIN_POINT_PX, borderTopColor: color }} />
    </span>
  );
}

function LabelBody({ label }: { label: PlacedLabel }) {
  const arrow = label.direction !== null && (
    <ArrowUp aria-hidden className="size-3.5 [rotate:var(--direction)]" strokeWidth={3} data-arrow />
  );
  switch (label.kind) {
    case "ENTRANCE":
    case "ENTRANCE_EXIT":
      return (
        <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white ring-2 ring-white" style={{ backgroundColor: COLORS.ENTRANCE }}>
          {arrow}
          {label.text}
        </span>
      );
    case "EXIT":
      return (
        <span className="flex items-center gap-1 border-2 border-dashed border-white px-2 py-0.5 text-xs font-semibold text-white outline-2 outline-white" style={{ backgroundColor: COLORS.EXIT }}>
          {arrow}
          {label.text}
        </span>
      );
    case "GUARD_BOOTH":
      return (
        <span className="flex items-center gap-1 rounded-sm bg-white px-1.5 py-0.5 text-xs font-semibold ring-1 ring-current" style={{ color: COLORS.GUARD_BOOTH }}>
          <span aria-hidden className="size-2.5" style={{ backgroundColor: COLORS.GUARD_BOOTH }} />
          {label.text}
        </span>
      );
    case "AREA":
      return <span className="text-xs font-semibold text-[#1e293b] [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_3px_#fff]">{label.text}</span>;
    default:
      return <span className="text-xs text-[#1e293b] [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_3px_#fff]">{label.text}</span>;
  }
}

const SELECTED_ID = "selected";

/**
 * Thai labels in the DOM over either view, so they stay sharp and readable at any zoom. They do
 * not take pointer events and never look like buttons; placement drops labels that would overlap.
 */
export function LabelLayer({
  labels,
  selection,
  markers,
  insets,
  callout,
  ref,
}: {
  labels: MapLabel[];
  selection: MapViewProps["selection"];
  markers?: MapViewProps["markers"];
  insets: Insets;
  callout?: ReactNode;
  ref: Ref<LabelLayerHandle>;
}) {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const calloutElement = useRef<HTMLDivElement>(null);
  const placed: PlacedLabel[] = labels.map((label) => ({ ...label, direction: label.landmark?.direction_rad ?? null }));
  const all: PlacedLabel[] = [
    ...placed,
    ...(markers ?? []).map((marker) => ({ id: `marker-${marker.id}`, text: marker.text, kind: "AREA" as const, anchor: marker.point, direction: null, raised: true, pin: marker.color })),
    ...(selection ? [{ id: SELECTED_ID, text: selection.text, kind: "AREA" as const, anchor: selection.point, direction: null, raised: true, pin: selection.destination ? COLORS.ENTRANCE : undefined }] : []),
  ];

  /** Puts the callout over the destination pin, or under its point when the top of the map has no room. */
  function placeCallout(project: (point: MetricPoint) => [number, number] | null, size: Size, pinCentre: [number, number] | undefined) {
    const element = calloutElement.current;
    if (!element) return;
    const pin = elements.current.get(SELECTED_ID);
    const point = selection?.destination ? project(selection.point) : null;
    if (!pinCentre || !pin || !point) {
      element.style.visibility = "hidden";
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = element;
    const above = pinCentre[1] - pin.offsetHeight / 2 - CALLOUT_GAP_PX - height;
    const y = above >= insets.top ? above : point[1] + CALLOUT_GAP_PX;
    const x = Math.min(Math.max(pinCentre[0] - width / 2, insets.left), size.width - insets.right - width);
    element.style.visibility = "visible";
    element.style.transform = `translate(${x}px, ${y}px)`;
  }

  useImperativeHandle(ref, () => ({
    update(project, size, zoom) {
      const candidates: LabelCandidate[] = [];
      for (const label of all) {
        const element = elements.current.get(label.id);
        const screen = project(label.anchor);
        if (!element || !screen) continue;
        // Selected and pinned labels sit just above their point instead of on it.
        const anchor: [number, number] = label.pin ? [screen[0], screen[1] - element.offsetHeight / 2 - PIN_POINT_PX] : label.raised ? [screen[0], screen[1] - 22] : screen;
        const kind = label.id === SELECTED_ID && selection?.destination ? "DESTINATION" : label.raised ? "SELECTED" : label.kind;
        candidates.push({ id: label.id, x: anchor[0], y: anchor[1], width: element.offsetWidth, height: element.offsetHeight, priority: LABEL_PRIORITY[kind], minZoom: LABEL_MIN_ZOOM[kind], pinned: !!label.pin });
        if (label.direction !== null) {
          const ahead = project({ x_m: label.anchor.x_m + Math.cos(label.direction) * 2, y_m: label.anchor.y_m + Math.sin(label.direction) * 2 });
          if (ahead) element.style.setProperty("--direction", `${Math.atan2(ahead[0] - screen[0], screen[1] - ahead[1])}rad`);
        }
      }
      const shown = placeLabels(candidates, { width: size.width, height: size.height, zoom, blocked: blockedRects(size, insets) });
      for (const [id, element] of elements.current) {
        const centre = shown.get(id);
        element.style.visibility = centre ? "visible" : "hidden";
        if (centre) element.style.transform = `translate(${centre[0] - element.offsetWidth / 2}px, ${centre[1] - element.offsetHeight / 2}px)`;
      }
      placeCallout(project, size, shown.get(SELECTED_ID));
    },
  }));

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
        {all.map((label) => (
          <div
            key={label.id}
            ref={(element) => {
              if (element) elements.current.set(label.id, element);
              else elements.current.delete(label.id);
            }}
            className="absolute top-0 left-0 whitespace-nowrap"
            style={{ visibility: "hidden" }}
          >
            {label.pin ? (
              <Pin text={label.text} color={label.pin} />
            ) : label.id === SELECTED_ID ? (
              <span className="rounded-md px-2 py-0.5 text-xs font-semibold text-white ring-2 ring-white" style={{ backgroundColor: COLORS.SELECTED }}>
                {label.text}
              </span>
            ) : (
              <LabelBody label={label} />
            )}
          </div>
        ))}
      </div>
      {callout && (
        // Its own layer, outside the hidden labels: it takes taps, which never reach the map below.
        <div
          ref={calloutElement}
          className="absolute top-0 left-0 z-10"
          style={{ visibility: "hidden" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {callout}
        </div>
      )}
    </>
  );
}

/** Turns a crash in a map view into a callback, so the page can fall back instead of going blank. */
export class ViewErrorBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Map view failed", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
