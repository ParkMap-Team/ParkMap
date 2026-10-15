import type { MotorcycleProxy } from "../api/types.ts";
import { axisHeading } from "./geometry.ts";

/**
 * The generic motorcycle in `public/models/motorcycle.glb`, built by
 * `scripts/motorcycle-model/build.ts`. Its length runs along +X, it is centred in X and Z, and its
 * wheels touch Y = 0. The test checks these numbers against the file.
 */
export const MOTORCYCLE_MODEL = { url: "/models/motorcycle.glb", lengthM: 1.86, widthM: 0.68, heightM: 1.06 } as const;

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
