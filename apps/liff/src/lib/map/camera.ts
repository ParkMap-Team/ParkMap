import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { MetricPoint } from "../api/types.ts";
import { type Bounds, boundsCenter, toWorld } from "./geometry.ts";

// Framing for both map views. The 3D overview looks from the camera side of the lot (metric -y, so
// the far edge is at the top of the screen, as in the 2D plan); people pan, zoom, turn, and tilt
// from there (ADR 0012), and reset returns to it. Insets keep the overview clear of the map's own controls.

/**
 * Steep enough that the far rows are not squeezed and the near ground does not fill the screen,
 * with a narrow lens so the lot keeps its plan proportions, yet low enough that blocks read as 3D.
 */
export const ELEVATION_RAD = (65 * Math.PI) / 180;
/** Tilt limits: low enough to look across the lot, never level with the ground or straight down. */
export const MIN_ELEVATION_RAD = (25 * Math.PI) / 180;
export const MAX_ELEVATION_RAD = (85 * Math.PI) / 180;
export const ROTATE_STEP_RAD = Math.PI / 8;
export const FOV_DEG = 30;
/** Zoom relative to the overview. */
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 6;
export const ZOOM_STEP = 1.5;
/**
 * The near plane follows the camera's distance. Depth precision falls with distance over the near
 * plane, and the flat layers (ground, paving, curbs) lie millimetres apart, so a fixed near plane
 * lets them fight and flicker in the wide opening view. The camera never comes this close to anything.
 */
export const MIN_NEAR_M = 0.5;
const NEAR_PER_DISTANCE = 0.03;

export function nearPlane(distance: number): number {
  return Math.max(MIN_NEAR_M, distance * NEAR_PER_DISTANCE);
}
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

/** Screen pixels per metre of ground at the camera's target, `distance` metres away. */
export function pixelsPerMetre(distance: number, screenHeight: number): number {
  return screenHeight / (2 * distance * Math.tan((FOV_DEG * Math.PI) / 360));
}

/** Drags the ground under the pointer by a screen offset, whichever way the camera faces. */
export function pan3D(view: View3D, dx: number, dy: number, screenHeight: number): View3D {
  const metresPerPixel = 1 / pixelsPerMetre(view.distance, screenHeight);
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
export function overview3D(bounds: Bounds, viewport: Viewport, elevationRad = ELEVATION_RAD): View3D {
  const camera = new PerspectiveCamera(FOV_DEG, viewport.width / viewport.height, 0.1, 2000);
  const corners = [
    { x_m: bounds.minX, y_m: bounds.minY },
    { x_m: bounds.maxX, y_m: bounds.minY },
    { x_m: bounds.maxX, y_m: bounds.maxY },
    { x_m: bounds.minX, y_m: bounds.maxY },
  ].map((point) => new Vector3(...toWorld(point)));
  const rect = freeRect(viewport);
  let view: View3D = { target: boundsCenter(bounds), distance: 1, azimuthRad: 0, elevationRad };
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

function freeSize({ width, height, insets }: Viewport): Size {
  return { width: Math.max(1, width - insets.left - insets.right), height: Math.max(1, height - insets.top - insets.bottom) };
}

/** The 2D view at a scale that puts `point` in the middle of the viewport outside the insets. */
export function centreOn2D(point: MetricPoint, pxPerM: number, viewport: Viewport): View2D {
  const free = freeSize(viewport);
  const offsetX = viewport.insets.left + free.width / 2 - viewport.width / 2;
  const offsetY = viewport.insets.top + free.height / 2 - viewport.height / 2;
  return { center: { x_m: point.x_m - offsetX / pxPerM, y_m: point.y_m + offsetY / pxPerM }, pxPerM };
}

export function overview2D(bounds: Bounds, viewport: Viewport): View2D {
  const free = freeSize(viewport);
  const pxPerM = Math.min(free.width / Math.max(bounds.maxX - bounds.minX, 1), free.height / Math.max(bounds.maxY - bounds.minY, 1)) * FILL;
  return centreOn2D(boundsCenter(bounds), pxPerM, viewport);
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

// ---- Camera moves -----------------------------------------------------------------------------

/** A fly to a chosen place (focus, reset) and a short nudge for one button step, in milliseconds. */
export const FLY_MS = 560;
export const NUDGE_MS = 220;
/** The opening move, from the wide view down to the overview, slow enough to follow. */
export const INTRO_MS = 1800;
/** The opening view is at least this much further out than the overview, even with nothing drawn around the lot. */
export const INTRO_MIN_ZOOM_OUT = 2;

/**
 * Where the 3D view opens: high above the lot and far enough out to show everything drawn around
 * it, such as the campus buildings and roads, so people see where the lot is before the camera flies
 * in to the overview. It looks at the lot, so the flight is a straight approach and stays inside pan limits.
 */
export function introView3D(lot: Bounds, surroundings: Bounds, viewport: Viewport): View3D {
  const centre = boundsCenter(lot);
  const halfX = Math.max(centre.x_m - surroundings.minX, surroundings.maxX - centre.x_m, (lot.maxX - lot.minX) / 2);
  const halfY = Math.max(centre.y_m - surroundings.minY, surroundings.maxY - centre.y_m, (lot.maxY - lot.minY) / 2);
  const around = { minX: centre.x_m - halfX, maxX: centre.x_m + halfX, minY: centre.y_m - halfY, maxY: centre.y_m + halfY };
  const wide = overview3D(around, viewport, MAX_ELEVATION_RAD);
  return { ...wide, distance: Math.max(wide.distance, overview3D(lot, viewport).distance * INTRO_MIN_ZOOM_OUT) };
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Scale moves in log space, so zooming in and out by the same factor take the same time. */
function mixLog(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * t);
}

function mixPoint(from: MetricPoint, to: MetricPoint, t: number): MetricPoint {
  return { x_m: from.x_m + (to.x_m - from.x_m) * t, y_m: from.y_m + (to.y_m - from.y_m) * t };
}

export function mix2D(from: View2D, to: View2D, t: number): View2D {
  return { center: mixPoint(from.center, to.center, t), pxPerM: mixLog(from.pxPerM, to.pxPerM, t) };
}

/** Turns the short way round, so a step past a half turn never spins the long way. */
export function mix3D(from: View3D, to: View3D, t: number): View3D {
  const turn = Math.atan2(Math.sin(to.azimuthRad - from.azimuthRad), Math.cos(to.azimuthRad - from.azimuthRad));
  return {
    target: mixPoint(from.target, to.target, t),
    distance: mixLog(from.distance, to.distance, t),
    azimuthRad: from.azimuthRad + turn * t,
    elevationRad: from.elevationRad + (to.elevationRad - from.elevationRad) * t,
  };
}

/** Space kept between a revealed point and the edge of whatever covers the map. */
export const REVEAL_MARGIN_PX = 48;

/**
 * The vertical drag (screen pixels, negative is up) that brings a point at screen `y` into the band
 * between `top` and `height - bottom`, or 0 when it is already visible there.
 */
export function revealOffset(y: number, height: number, top: number, bottom: number): number {
  const low = height - bottom - REVEAL_MARGIN_PX;
  const high = top + REVEAL_MARGIN_PX;
  if (low <= high) return 0;
  if (y > low) return low - y;
  if (y < high) return high - y;
  return 0;
}
