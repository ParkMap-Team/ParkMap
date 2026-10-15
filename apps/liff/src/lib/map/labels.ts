import type { LandmarkKind } from "../api/types.ts";

// Map label placement shared by the 2D and 3D views: labels are measured in the DOM, placed in
// screen space, and dropped rather than overlapped. Higher priority wins; ties keep a stable order.

export type ScreenRect = { x0: number; y0: number; x1: number; y1: number };

export type LabelCandidate = {
  id: string;
  /** Screen anchor; the label is centred on it. */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  /** The label shows only at this zoom (relative to the overview) or closer. */
  minZoom: number;
};

/** Entrances and exits first, then the selection, then the rest. */
export const LABEL_PRIORITY = {
  ENTRANCE: 100,
  EXIT: 100,
  ENTRANCE_EXIT: 100,
  SELECTED: 90,
  GUARD_BOOTH: 80,
  BUILDING: 60,
  AREA: 50,
  BARRIER: 40,
  AISLE: 30,
} as const satisfies Record<LandmarkKind | "SELECTED" | "AREA", number>;

/** Small features wait for a closer zoom so the overview stays readable. */
export const LABEL_MIN_ZOOM = {
  ENTRANCE: 0,
  EXIT: 0,
  ENTRANCE_EXIT: 0,
  SELECTED: 0,
  GUARD_BOOTH: 0,
  BUILDING: 0,
  AREA: 0,
  BARRIER: 1.4,
  AISLE: 1.4,
} as const satisfies Record<keyof typeof LABEL_PRIORITY, number>;

const GAP_PX = 4;

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.x0 < b.x1 + GAP_PX && b.x0 < a.x1 + GAP_PX && a.y0 < b.y1 + GAP_PX && b.y0 < a.y1 + GAP_PX;
}

export function labelRect({ x, y, width, height }: Pick<LabelCandidate, "x" | "y" | "width" | "height">): ScreenRect {
  return { x0: x - width / 2, y0: y - height / 2, x1: x + width / 2, y1: y + height / 2 };
}

/**
 * Where each shown label goes, by id, as its screen centre: inside the viewport, clear of blocked
 * areas such as the map controls, allowed at this zoom, and not overlapping a label of higher
 * priority. A label that does not fit on its anchor may sit just below, above, left, or right of it instead.
 */
export function placeLabels(
  candidates: LabelCandidate[],
  viewport: { width: number; height: number; zoom: number; blocked?: ScreenRect[] },
): Map<string, [number, number]> {
  const placed: ScreenRect[] = [...(viewport.blocked ?? [])];
  const shown = new Map<string, [number, number]>();
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index);
  for (const { candidate } of ordered) {
    if (viewport.zoom < candidate.minZoom) continue;
    const down = candidate.height + GAP_PX;
    const side = candidate.width / 2 + GAP_PX;
    for (const [dx, dy] of [[0, 0], [0, down], [0, -down], [-side, 0], [side, 0]]) {
      const rect = labelRect({ ...candidate, x: candidate.x + dx, y: candidate.y + dy });
      if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > viewport.width || rect.y1 > viewport.height) continue;
      if (placed.some((other) => overlaps(rect, other))) continue;
      placed.push(rect);
      shown.set(candidate.id, [candidate.x + dx, candidate.y + dy]);
      break;
    }
  }
  return shown;
}
