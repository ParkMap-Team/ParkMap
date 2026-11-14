import { useLayoutEffect, useState } from "react";
import type { MetricPoint } from "../api/types.ts";
import { revealRoute, ROUTE_REVEAL_MS } from "./route-reveal";

export function useRouteReveal(route: readonly MetricPoint[] | undefined, replay: number | undefined) {
  const key = route?.map(({ x_m, y_m }) => `${x_m},${y_m}`).join(" ");
  const [progress, setProgress] = useState(1);
  useLayoutEffect(() => {
    if (!key) {
      setProgress(1);
      return;
    }
    // Pressing the preview button explicitly requests the animation.
    const reducedMotion = !replay && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    setProgress(0);
    let previousFrame = performance.now();
    let elapsed = 0;
    let frame: number | undefined;
    function tick(now: number) {
      // Keep the first visible step small even when the browser drops a frame.
      elapsed += Math.min(Math.max(0, now - previousFrame), 50);
      previousFrame = now;
      const next = Math.min(1, elapsed / ROUTE_REVEAL_MS);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [key, replay]);
  const eased = progress * progress * (3 - 2 * progress);
  return { visibleRoute: route && progress > 0 ? revealRoute(route, eased) : undefined, revealing: Boolean(route) && progress < 1 };
}
