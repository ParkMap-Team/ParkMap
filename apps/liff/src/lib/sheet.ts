// Physics for the map's bottom sheet on phones. The sheet rests either open (offset 0) or at its
// peek (offset `collapsed`, measured in pixels pushed down). A fling picks the rest where its
// momentum would carry it, and a drag past either rest gives way with growing resistance.

/** How fast a fling slows down, per millisecond, as in a native scroll view. */
const DECELERATION = 0.998;
const RUBBER_BAND = 0.55;

/** How far a fling at `velocity` px/s would travel before it stops. */
export function project(velocity: number): number {
  return ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** The distance shown for a drag `overshoot` pixels past a rest, on a surface `dimension` pixels tall. */
export function rubberband(overshoot: number, dimension: number): number {
  return (overshoot * dimension * RUBBER_BAND) / (dimension + RUBBER_BAND * Math.abs(overshoot));
}

/** The offset shown for a raw drag offset; past either rest the sheet resists. */
export function dragOffset(raw: number, collapsed: number, dimension: number): number {
  if (raw < 0) return rubberband(raw, dimension);
  if (raw > collapsed) return collapsed + rubberband(raw - collapsed, dimension);
  return raw;
}

/** Whether a sheet released at `offset` with `velocity` px/s (positive is down) comes to rest open. */
export function restsOpen(offset: number, velocity: number, collapsed: number): boolean {
  return offset + project(velocity) < collapsed / 2;
}
