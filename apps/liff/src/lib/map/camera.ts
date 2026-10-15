import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { MetricPoint } from "../api/types.ts";
import { type Bounds, boundsCenter, toWorld } from "./geometry.ts";

// Framing for both map views. The 3D overview looks from the camera side of the lot (metric -y, so
// the far edge is at the top of the screen, as in the 2D plan); people pan, zoom, turn, and tilt
// from there (ADR 0012), and reset returns to it. Insets keep the overview clear of the map's own controls.

export const ELEVATION_RAD = (55 * Math.PI) / 180;
/** Tilt limits: low enough to look across the lot, never level with the ground or straight down. */
export const MIN_ELEVATION_RAD = (25 * Math.PI) / 180;
export const MAX_ELEVATION_RAD = (85 * Math.PI) / 180;
export const ROTATE_STEP_RAD = Math.PI / 8;
export const FOV_DEG = 40;
/** Zoom relative to the overview. */
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 6;
export const ZOOM_STEP = 1.5;
/** The share of the free viewport the overview fills. */
const FILL = 0.9;

export type Insets = { top: number; right: number; bottom: number; left: number };
export type Viewport = { width: number; height: number; insets: Insets };

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Pan never leaves the lot: the view centre stays inside its bounds. */
export function clampToBounds({ x_m, y_m }: MetricPoint, bounds: Bounds): MetricPoint {
  return { x_m: Math.min(bounds.maxX, Math.max(bounds.minX, x_m)), y_m: Math.min(bounds.maxY, Math.max(bounds.minY, y_m)) };
}

// ---- 3D -------------------------------------------------------------------------------------

/**
 * Where the camera looks from. `azimuthRad` turns it around the target, 0 on the metric -y side
 * and growing toward +x; `elevationRad` is its angle above the ground.
 */
export type View3D = { target: MetricPoint; distance: number; azimuthRad: number; elevationRad: number };

/** World camera position for a view. */
export function cameraPosition({ target, distance, azimuthRad, elevationRad }: View3D): [number, number, number] {
  const [x, , z] = toWorld(target);
  const across = distance * Math.cos(elevationRad);
  return [x + across * Math.sin(azimuthRad), distance * Math.sin(elevationRad), z + across * Math.cos(azimuthRad)];
}

/** The view of a camera at a world position looking at a ground target. */
export function viewFrom([x, y, z]: [number, number, number], target: MetricPoint): View3D {
  const [targetX, , targetZ] = toWorld(target);
  const across = Math.hypot(x - targetX, z - targetZ);
  return { target, distance: Math.hypot(across, y), azimuthRad: Math.atan2(x - targetX, z - targetZ), elevationRad: Math.atan2(y, across) };
}

/** Drags the ground under the pointer by a screen offset, whichever way the camera faces. */
export function pan3D(view: View3D, dx: number, dy: number, screenHeight: number): View3D {
  const metresPerPixel = (2 * view.distance * Math.tan((FOV_DEG * Math.PI) / 360)) / screenHeight;
  const cos = Math.cos(view.azimuthRad);
  const sin = Math.sin(view.azimuthRad);
  // Screen right is metric (cos, sin) and screen up is metric (-sin, cos).
  return {
    ...view,
    target: { x_m: view.target.x_m - (dx * cos + dy * sin) * metresPerPixel, y_m: view.target.y_m + (dy * cos - dx * sin) * metresPerPixel },
  };
}

function poseCamera(camera: PerspectiveCamera, view: View3D): void {
  camera.position.set(...cameraPosition(view));
  camera.lookAt(new Vector3(...toWorld(view.target)));
  camera.updateMatrixWorld();
}

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

function groundAt(camera: PerspectiveCamera, ndcX: number, ndcY: number): MetricPoint | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const hit = raycaster.ray.intersectPlane(GROUND, new Vector3());
  return hit ? { x_m: hit.x, y_m: -hit.z } : null;
}

function freeRect({ width, height, insets }: Viewport) {
  return {
    x0: -1 + (2 * insets.left) / width,
    x1: 1 - (2 * insets.right) / width,
    y0: -1 + (2 * insets.bottom) / height,
    y1: 1 - (2 * insets.top) / height,
  };
}

function projectedBox(camera: PerspectiveCamera, corners: Vector3[]) {
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const corner of corners) {
    const ndc = corner.clone().project(camera);
    box.x0 = Math.min(box.x0, ndc.x);
    box.x1 = Math.max(box.x1, ndc.x);
    box.y0 = Math.min(box.y0, ndc.y);
    box.y1 = Math.max(box.y1, ndc.y);
  }
  return box;
}

/**
 * The elevated overview that fits the whole place into the viewport outside the insets. Perspective
 * makes the near edge look wider than the far edge, so the target is re-centred a few times.
 */
export function overview3D(bounds: Bounds, viewport: Viewport): View3D {
  const camera = new PerspectiveCamera(FOV_DEG, viewport.width / viewport.height, 0.1, 2000);
  const corners = [
    { x_m: bounds.minX, y_m: bounds.minY },
    { x_m: bounds.maxX, y_m: bounds.minY },
    { x_m: bounds.maxX, y_m: bounds.maxY },
    { x_m: bounds.minX, y_m: bounds.maxY },
  ].map((point) => new Vector3(...toWorld(point)));
  const rect = freeRect(viewport);
  let view: View3D = { target: boundsCenter(bounds), distance: 1, azimuthRad: 0, elevationRad: ELEVATION_RAD };
  for (let pass = 0; pass < 4; pass++) {
    let near = 0.5;
    let far = 2000;
    for (let step = 0; step < 40; step++) {
      const distance = (near + far) / 2;
      poseCamera(camera, { ...view, distance });
      const box = projectedBox(camera, corners);
      const fits = box.x1 - box.x0 <= (rect.x1 - rect.x0) * FILL && box.y1 - box.y0 <= (rect.y1 - rect.y0) * FILL && box.y1 < 1;
      if (fits) far = distance;
      else near = distance;
    }
    view = { ...view, distance: far };
    poseCamera(camera, view);
    const box = projectedBox(camera, corners);
    const shown = groundAt(camera, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    const wanted = groundAt(camera, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
    if (!shown || !wanted) break;
    view = { ...view, target: { x_m: view.target.x_m + shown.x_m - wanted.x_m, y_m: view.target.y_m + shown.y_m - wanted.y_m } };
  }
  return view;
}

// ---- 2D -------------------------------------------------------------------------------------

/** A top-down plan view: the metric point at the screen centre and the scale. */
export type View2D = { center: MetricPoint; pxPerM: number };
export type Size = { width: number; height: number };

export function overview2D(bounds: Bounds, viewport: Viewport): View2D {
  const { width, height, insets } = viewport;
  const freeWidth = Math.max(1, width - insets.left - insets.right);
  const freeHeight = Math.max(1, height - insets.top - insets.bottom);
  const pxPerM = Math.min(freeWidth / Math.max(bounds.maxX - bounds.minX, 1), freeHeight / Math.max(bounds.maxY - bounds.minY, 1)) * FILL;
  const middle = boundsCenter(bounds);
  const freeCenterX = insets.left + freeWidth / 2;
  const freeCenterY = insets.top + freeHeight / 2;
  return { center: { x_m: middle.x_m - (freeCenterX - width / 2) / pxPerM, y_m: middle.y_m + (freeCenterY - height / 2) / pxPerM }, pxPerM };
}

/** Metric +y is up on screen, matching the 3D view from the camera side. */
export function toScreen(view: View2D, size: Size, { x_m, y_m }: MetricPoint): [number, number] {
  return [size.width / 2 + (x_m - view.center.x_m) * view.pxPerM, size.height / 2 - (y_m - view.center.y_m) * view.pxPerM];
}

export function fromScreen(view: View2D, size: Size, x: number, y: number): MetricPoint {
  return { x_m: view.center.x_m + (x - size.width / 2) / view.pxPerM, y_m: view.center.y_m - (y - size.height / 2) / view.pxPerM };
}

/** Zoom about a screen point, which stays over the same ground; the scale stays within the zoom limits. */
export function zoom2D(view: View2D, overviewPxPerM: number, factor: number, size: Size, anchor: [number, number], bounds: Bounds): View2D {
  const pxPerM = clampZoom((view.pxPerM * factor) / overviewPxPerM) * overviewPxPerM;
  const ground = fromScreen(view, size, ...anchor);
  const center = {
    x_m: ground.x_m - (anchor[0] - size.width / 2) / pxPerM,
    y_m: ground.y_m + (anchor[1] - size.height / 2) / pxPerM,
  };
  return { center: clampToBounds(center, bounds), pxPerM };
}

export function pan2D(view: View2D, dx: number, dy: number, bounds: Bounds): View2D {
  return { ...view, center: clampToBounds({ x_m: view.center.x_m - dx / view.pxPerM, y_m: view.center.y_m + dy / view.pxPerM }, bounds) };
}
