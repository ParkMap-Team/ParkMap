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

/** Map controls sit in a column on the right; the overview and labels keep clear of it. */
export const MAP_INSETS: Insets = { top: 12, right: 64, bottom: 12, left: 12 };

export type MapViewHandle = {
  zoomBy(factor: number): void;
  /** The elevated overview of the whole place. */
  reset(): void;
  focus(point: MetricPoint): void;
  panBy(dx: number, dy: number): void;
  /** Turns the map counter-clockwise on screen by `rad`; only the 3D view turns. */
  rotateBy?(rad: number): void;
};

export type MapViewProps = {
  map: LotMap;
  labels: MapLabel[];
  /** The selected place: its outline in the current data, and where its label sits. */
  selection: { point: MetricPoint; polygon: MetricPolygon | null; text: string } | null;
  onSelect(point: MetricPoint | null): void;
  ref?: Ref<MapViewHandle>;
};

/** The control column, in screen pixels, so labels never hide under it. */
export function blockedRects({ width }: Size): ScreenRect[] {
  return [{ x0: width - MAP_INSETS.right, y0: 0, x1: width, y1: 380 }];
}

export type LabelLayerHandle = {
  /** Positions every label from ground to screen; `project` returns null for points off screen. */
  update(project: (point: MetricPoint) => [number, number] | null, size: Size, zoom: number): void;
};

type PlacedLabel = Pick<MapLabel, "id" | "text" | "kind" | "anchor"> & { direction: number | null };

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
      return <span className="text-[11px] font-medium text-slate-600 [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_3px_#fff]">{label.text}</span>;
    default:
      return <span className="text-xs font-medium text-stone-700 [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_3px_#fff]">{label.text}</span>;
  }
}

const SELECTED_ID = "selected";

/**
 * Thai labels in the DOM over either view, so they stay sharp and readable at any zoom. They do
 * not take pointer events and never look like buttons; placement drops labels that would overlap.
 */
export function LabelLayer({ labels, selection, ref }: { labels: MapLabel[]; selection: MapViewProps["selection"]; ref: Ref<LabelLayerHandle> }) {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const placed: PlacedLabel[] = labels.map((label) => ({ ...label, direction: label.landmark?.direction_rad ?? null }));
  const all = selection ? [...placed, { id: SELECTED_ID, text: selection.text, kind: "AREA" as const, anchor: selection.point, direction: null }] : placed;

  useImperativeHandle(ref, () => ({
    update(project, size, zoom) {
      const candidates: LabelCandidate[] = [];
      for (const label of all) {
        const element = elements.current.get(label.id);
        const screen = project(label.anchor);
        if (!element || !screen) continue;
        // Selected labels sit just above the selected point instead of on it.
        const anchor: [number, number] = label.id === SELECTED_ID ? [screen[0], screen[1] - 22] : screen;
        const kind = label.id === SELECTED_ID ? "SELECTED" : label.kind;
        candidates.push({ id: label.id, x: anchor[0], y: anchor[1], width: element.offsetWidth, height: element.offsetHeight, priority: LABEL_PRIORITY[kind], minZoom: LABEL_MIN_ZOOM[kind] });
        if (label.direction !== null) {
          const ahead = project({ x_m: label.anchor.x_m + Math.cos(label.direction) * 2, y_m: label.anchor.y_m + Math.sin(label.direction) * 2 });
          if (ahead) element.style.setProperty("--direction", `${Math.atan2(ahead[0] - screen[0], screen[1] - ahead[1])}rad`);
        }
      }
      const shown = placeLabels(candidates, { width: size.width, height: size.height, zoom, blocked: blockedRects(size) });
      for (const [id, element] of elements.current) {
        const centre = shown.get(id);
        element.style.visibility = centre ? "visible" : "hidden";
        if (centre) element.style.transform = `translate(${centre[0] - element.offsetWidth / 2}px, ${centre[1] - element.offsetHeight / 2}px)`;
      }
    },
  }));

  return (
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
          {label.id === SELECTED_ID ? (
            <span className="rounded-md px-2 py-0.5 text-xs font-semibold text-white ring-2 ring-white" style={{ backgroundColor: COLORS.SELECTED }}>
              {label.text}
            </span>
          ) : (
            <LabelBody label={label} />
          )}
        </div>
      ))}
    </div>
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
