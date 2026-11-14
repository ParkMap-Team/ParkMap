import type { MetricPoint, MotorcycleProxy } from "../api/types.ts";
import { MOTORCYCLE_PAINTS } from "../parking/presentation.ts";
import { axisHeading } from "./geometry.ts";

/**
 * The generic motorcycle in `public/models/motorcycle.glb`, built by
 * `scripts/motorcycle-model/build.ts`. Its length runs along +X, it is centred in X and Z, and its
 * wheels touch Y = 0. The test checks these numbers against the file.
 */
export const MOTORCYCLE_MODEL = { url: "/models/motorcycle.glb", lengthM: 1.919, widthM: 0.69, heightM: 1.348 } as const;

/**
 * Where to draw the model for one proxy: on the proxy centre, turned to its long axis, and
 * stretched onto the footprint the API returned. Height follows the length so it keeps its shape.
 * World rotation about +Y by the metric heading maps the model's +X onto the proxy's long axis.
 */
export function motorcycleTransform(proxy: MotorcycleProxy) {
  const lengthScale = proxy.length_m / MOTORCYCLE_MODEL.lengthM;
  return {
    position: [proxy.center.x_m, 0, -proxy.center.y_m] as [number, number, number],
    rotationY: axisHeading(proxy.heading_rad),
    scale: [lengthScale, lengthScale, proxy.width_m / MOTORCYCLE_MODEL.widthM] as [number, number, number],
  };
}

/**
 * The paint for the model at this ground position, as `#rrggbb`. It is decoration, not identity: the
 * API sends no vehicle colour, and its detection IDs hold for one frame only. Two crossed waves of
 * position spread neighbours across the paints, and a detection that moves a few centimetres
 * between frames keeps nearly the same shade.
 */
export function motorcyclePaint({ x_m, y_m }: MetricPoint): string {
  const wave = Math.sin(2.1 * x_m + 0.9 * y_m) + Math.sin(-1.3 * x_m + 1.7 * y_m);
  // Clamped, so the lightest and darkest paints show as often as the greys between them.
  const t = Math.min(Math.max(0.5 + wave / 2, 0), 1) * (MOTORCYCLE_PAINTS.length - 1);
  const index = Math.min(Math.floor(t), MOTORCYCLE_PAINTS.length - 2);
  const from = Number.parseInt(MOTORCYCLE_PAINTS[index].slice(1), 16);
  const to = Number.parseInt(MOTORCYCLE_PAINTS[index + 1].slice(1), 16);
  const channel = (shift: number) => Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * (t - index));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}
