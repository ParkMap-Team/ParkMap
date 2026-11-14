"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { MetricPolygon } from "@/lib/api/types";
import { type Insets, type Size, overview2D, toScreen } from "@/lib/map/camera";
import type { Bounds } from "@/lib/map/geometry";
import { COLORS } from "@/lib/parking/presentation";

/**
 * What shows while a map view loads: the lot's outline from the lot model, where the overview will
 * put it, with no status at all. It sits behind both views, so the map arrives without a jump.
 */
export function MapSkeleton({ outline, bounds, insets, loading }: { outline: MetricPolygon; bounds: Bounds; insets: Insets; loading: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

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

  const view = size && overview2D(bounds, { ...size, insets });
  const path = view && size ? outline.map((ring) => `M${ring.map((point) => toScreen(view, size, point).join(",")).join("L")}Z`).join("") : null;
  return (
    <div ref={container} className="absolute inset-0" style={{ backgroundColor: COLORS.GROUND }}>
      {path && (
        <svg aria-hidden className="absolute inset-0 size-full">
          <path d={path} fill={COLORS.LOT} fillRule="evenodd" />
        </svg>
      )}
      <p role="status" className="absolute inset-x-0 text-center text-sm text-muted-foreground" style={{ top: insets.top }}>
        {loading && "กำลังโหลดแผนที่"}
      </p>
    </div>
  );
}
