import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import {
  ELEVATION_RAD,
  FOV_DEG,
  MAX_ZOOM,
  MIN_ELEVATION_RAD,
  cameraPosition,
  fromScreen,
  overview2D,
  overview3D,
  pan2D,
  pan3D,
  toScreen,
  viewFrom,
  zoom2D,
} from "./camera.ts";
import type { Bounds } from "./geometry.ts";
import { labelRect, placeLabels } from "./labels.ts";
import { INITIAL_RENDERER, mountsThreeD, rendererReducer, type RendererEvent } from "./renderer.ts";

const bounds: Bounds = { minX: -3, minY: 1, maxX: 29, maxY: 14 };
const phone = { width: 360, height: 420, insets: { top: 8, right: 60, bottom: 8, left: 8 } };

function projected(view: ReturnType<typeof overview3D>, viewport: typeof phone, x: number, y: number) {
  const camera = new PerspectiveCamera(FOV_DEG, viewport.width / viewport.height, 0.1, 2000);
  camera.position.set(...cameraPosition(view));
  camera.lookAt(view.target.x_m, 0, -view.target.y_m);
  camera.updateMatrixWorld();
  const ndc = new Vector3(x, 0, -y).project(camera);
  return [((ndc.x + 1) / 2) * viewport.width, ((1 - ndc.y) / 2) * viewport.height];
}

test("the 3D overview shows the whole place clear of the controls", () => {
  for (const viewport of [phone, { width: 1000, height: 700, insets: { top: 8, right: 60, bottom: 8, left: 8 } }]) {
    const view = overview3D(bounds, viewport);
    for (const [x, y] of [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]]) {
      const [sx, sy] = projected(view, viewport, x, y);
      assert.ok(sx >= viewport.insets.left - 0.5 && sx <= viewport.width - viewport.insets.right + 0.5, `x ${sx}`);
      assert.ok(sy >= viewport.insets.top - 0.5 && sy <= viewport.height - viewport.insets.bottom + 0.5, `y ${sy}`);
    }
  }
});

function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`);
}

test("the 3D overview looks from the camera side at the default elevation", () => {
  const view = overview3D(bounds, phone);
  assert.equal(view.azimuthRad, 0);
  assert.equal(view.elevationRad, ELEVATION_RAD);
  const position = cameraPosition({ target: { x_m: 1, y_m: 2 }, distance: 10, azimuthRad: 0, elevationRad: ELEVATION_RAD });
  near(position[0], 1, "x");
  assert.ok(position[2] > -2, "in front of the target on the metric -y side");
  near(Math.atan2(position[1], position[2] + 2), (55 * Math.PI) / 180, "elevation");
});

test("a turned camera looks from another side and its view round-trips", () => {
  const view = { target: { x_m: 1, y_m: 2 }, distance: 10, azimuthRad: Math.PI / 2, elevationRad: MIN_ELEVATION_RAD };
  const position = cameraPosition(view);
  // A quarter turn puts the camera on the metric +x side of the target.
  assert.ok(position[0] > 1);
  near(position[2], -2, "z");
  const back = viewFrom(position, view.target);
  near(back.distance, view.distance, "distance");
  near(back.azimuthRad, view.azimuthRad, "azimuth");
  near(back.elevationRad, view.elevationRad, "elevation");
});

test("3D pan drags the ground the way the camera faces", () => {
  const view = { target: { x_m: 0, y_m: 0 }, distance: 10, azimuthRad: 0, elevationRad: ELEVATION_RAD };
  const metres = (px: number) => (2 * 10 * Math.tan((FOV_DEG * Math.PI) / 360) * px) / phone.height;
  // Facing +y, dragging right reveals the -x side and dragging down reveals the far side.
  const facingFar = pan3D(view, 30, 40, phone.height).target;
  near(facingFar.x_m, -metres(30), "x");
  near(facingFar.y_m, metres(40), "y");
  // Turned a quarter, the camera faces -x: screen right is +y and screen up is -x.
  const turned = pan3D({ ...view, azimuthRad: Math.PI / 2 }, 30, 40, phone.height).target;
  near(turned.x_m, -metres(40), "turned x");
  near(turned.y_m, -metres(30), "turned y");
});

test("the 2D overview fits the bounds inside the free viewport", () => {
  const view = overview2D(bounds, phone);
  const [x0, y0] = toScreen(view, phone, { x_m: bounds.minX, y_m: bounds.maxY });
  const [x1, y1] = toScreen(view, phone, { x_m: bounds.maxX, y_m: bounds.minY });
  assert.ok(x0 >= 8 && x1 <= 300 && y0 >= 8 && y1 <= 412);
  assert.ok(y0 < y1, "metric +y is up on screen");
});

test("2D screen and ground conversions round-trip", () => {
  const view = overview2D(bounds, phone);
  const point = fromScreen(view, phone, ...toScreen(view, phone, { x_m: 4.5, y_m: 7.25 }));
  assert.ok(Math.abs(point.x_m - 4.5) < 1e-9 && Math.abs(point.y_m - 7.25) < 1e-9);
});

test("2D zoom keeps the anchor over the same ground and respects the limit", () => {
  const view = overview2D(bounds, phone);
  const anchor: [number, number] = [120, 200];
  const before = fromScreen(view, phone, ...anchor);
  const zoomed = zoom2D(view, view.pxPerM, 2, phone, anchor, bounds);
  const after = fromScreen(zoomed, phone, ...anchor);
  assert.ok(Math.abs(before.x_m - after.x_m) < 1e-9 && Math.abs(before.y_m - after.y_m) < 1e-9);
  const far = zoom2D(view, view.pxPerM, 100, phone, anchor, bounds);
  assert.ok(Math.abs(far.pxPerM / view.pxPerM - MAX_ZOOM) < 1e-9);
});

test("2D pan stops at the lot bounds", () => {
  const view = overview2D(bounds, phone);
  const panned = pan2D(view, -100_000, 100_000, bounds);
  // Dragging left and down reveals the right and the far (+y) side.
  assert.deepEqual(panned.center, { x_m: bounds.maxX, y_m: bounds.maxY });
});

test("labels never overlap, stay on screen, and yield to higher priority", () => {
  const shown = placeLabels(
    [
      { id: "barrier", x: 100, y: 100, width: 80, height: 20, priority: 40, minZoom: 0 },
      { id: "entrance", x: 110, y: 105, width: 60, height: 20, priority: 100, minZoom: 0 },
      { id: "booth", x: 110, y: 112, width: 60, height: 20, priority: 80, minZoom: 0 },
      { id: "edge", x: 5, y: 50, width: 60, height: 20, priority: 60, minZoom: 0 },
      { id: "aisle", x: 250, y: 250, width: 60, height: 20, priority: 30, minZoom: 1.4 },
      { id: "control", x: 330, y: 30, width: 40, height: 20, priority: 60, minZoom: 0 },
    ],
    { width: 360, height: 400, zoom: 1, blocked: [{ x0: 300, y0: 0, x1: 360, y1: 200 }] },
  );
  // The entrance keeps its anchor; the booth moves just below it, the barrier just above, and the
  // label at the edge to the right of its anchor. The one under the controls has no room.
  assert.deepEqual(Object.fromEntries(shown), { entrance: [110, 105], booth: [110, 136], barrier: [100, 76], edge: [39, 50] });
  const rects = [...shown].map(([id, [x, y]]) => labelRect({ x, y, width: id === "barrier" ? 80 : 60, height: 20 }));
  for (const [index, a] of rects.entries()) {
    for (const b of rects.slice(index + 1)) assert.ok(a.y1 <= b.y0 || b.y1 <= a.y0 || a.x1 <= b.x0 || b.x1 <= a.x0);
  }
});

test("a label beside the controls moves to the left of its anchor", () => {
  const exit = { id: "exit", x: 300, y: 150, width: 80, height: 20, priority: 100, minZoom: 0 };
  const shown = placeLabels([exit], { width: 360, height: 400, zoom: 1, blocked: [{ x0: 336, y0: 0, x1: 360, y1: 300 }] });
  assert.deepEqual(shown.get("exit"), [256, 150]);
});

test("small features get their labels when zoomed in", () => {
  const candidate = { id: "aisle", x: 100, y: 100, width: 60, height: 20, priority: 30, minZoom: 1.4 };
  assert.equal(placeLabels([candidate], { width: 360, height: 400, zoom: 1.5 }).has("aisle"), true);
});

function run(...events: RendererEvent[]) {
  return events.reduce(rendererReducer, INITIAL_RENDERER);
}

test("without WebGL the map is 2D at once and 3D cannot be chosen", () => {
  const state = run({ type: "webgl", available: false }, { type: "choose", mode: "3d" });
  assert.deepEqual(state, { mode: "2d", status3d: "unavailable" });
  assert.equal(mountsThreeD(state), false);
});

test("3D that is not ready in time falls back to 2D and can be retried", () => {
  const timedOut = run({ type: "webgl", available: true }, { type: "timeout" });
  assert.deepEqual(timedOut, { mode: "2d", status3d: "timed-out" });
  const retry = rendererReducer(timedOut, { type: "choose", mode: "3d" });
  assert.deepEqual(retry, { mode: "3d", status3d: "loading" });
  assert.deepEqual(rendererReducer(retry, { type: "ready" }), { mode: "3d", status3d: "ready" });
});

test("a ready 3D view ignores a late timeout, and a failure falls back to 2D", () => {
  const ready = run({ type: "webgl", available: true }, { type: "ready" }, { type: "timeout" });
  assert.deepEqual(ready, { mode: "3d", status3d: "ready" });
  assert.deepEqual(rendererReducer(ready, { type: "failed" }), { mode: "2d", status3d: "failed" });
});

test("people can switch between 2D and 3D by hand", () => {
  const ready = run({ type: "webgl", available: true }, { type: "ready" });
  const flat = rendererReducer(ready, { type: "choose", mode: "2d" });
  assert.deepEqual(flat, { mode: "2d", status3d: "ready" });
  assert.equal(mountsThreeD(flat), false);
  assert.deepEqual(rendererReducer(flat, { type: "choose", mode: "3d" }), ready);
});
