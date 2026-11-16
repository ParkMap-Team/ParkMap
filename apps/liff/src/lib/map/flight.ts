// Drives one camera move frame by frame. A new move or a touch on the map cancels the current one,
// and the next move starts from wherever the camera is, so every move can be interrupted. With
// reduced motion the move is a cut.

export type Flight = { cancel(): void; readonly active: boolean };

const LANDED: Flight = { cancel() {}, active: false };

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Calls `frame` with the eased progress from just above 0 to 1. */
export function fly(durationMs: number, ease: (t: number) => number, frame: (progress: number) => void): Flight {
  if (durationMs <= 0 || prefersReducedMotion()) {
    frame(1);
    return LANDED;
  }
  let request = 0;
  let start: number | null = null;
  let active = true;
  const step = (now: number) => {
    start ??= now;
    const t = Math.min(1, (now - start) / durationMs);
    if (t >= 1) active = false;
    frame(t >= 1 ? 1 : ease(t));
    if (active) request = requestAnimationFrame(step);
  };
  request = requestAnimationFrame(step);
  return {
    cancel() {
      active = false;
      cancelAnimationFrame(request);
    },
    get active() {
      return active;
    },
  };
}
