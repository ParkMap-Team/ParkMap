import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import {
  ELEVATION_RAD,
  FOV_DEG,
  INTRO_MIN_ZOOM_OUT,
  MAX_ELEVATION_RAD,
  MAX_ZOOM,
  MIN_ELEVATION_RAD,
  NO_INSETS,
  type View3D,
  cameraPosition,
  centreOn2D,
  easeInOut,
  easeOut,
  fromScreen,
  introView3D,
  mix2D,
  mix3D,
  nearPlane,
  overview2D,
  overview3D,
  pan2D,
  pan3D,
  pixelsPerMetre,
  revealOffset,
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

test("the 3D view opens wide on the lot and everything around it, from above", () => {
  const surroundings: Bounds = { minX: -40, minY: -60, maxX: 50, maxY: 70 };
  for (const viewport of [phone, { width: 1000, height: 700, insets: { top: 8, right: 60, bottom: 8, left: 8 } }]) {
    const intro = introView3D(bounds, surroundings, viewport);
    const overview = overview3D(bounds, viewport);
    assert.equal(intro.elevationRad, MAX_ELEVATION_RAD);
    assert.equal(intro.azimuthRad, overview.azimuthRad);
    for (const [x, y] of [[surroundings.minX, surroundings.minY], [surroundings.maxX, surroundings.minY], [surroundings.maxX, surroundings.maxY], [surroundings.minX, surroundings.maxY]]) {
      const [sx, sy] = projected(intro, viewport, x, y);
      assert.ok(sx >= viewport.insets.left - 0.5 && sx <= viewport.width - viewport.insets.right + 0.5, `x ${sx}`);
      assert.ok(sy >= viewport.insets.top - 0.5 && sy <= viewport.height - viewport.insets.bottom + 0.5, `y ${sy}`);
    }
    // The lot stays in the middle of the free area, so the flight in is a straight approach.
    const freeWidth = viewport.width - viewport.insets.left - viewport.insets.right;
    const freeHeight = viewport.height - viewport.insets.top - viewport.insets.bottom;
    const [lx, ly] = projected(intro, viewport, (bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    assert.ok(Math.abs(lx - (viewport.insets.left + freeWidth / 2)) < freeWidth * 0.03, `lot x ${lx}`);
    assert.ok(Math.abs(ly - (viewport.insets.top + freeHeight / 2)) < freeHeight * 0.03, `lot y ${ly}`);
  }
});

test("the 3D view opens well out even with nothing drawn around the lot", () => {
  const intro = introView3D(bounds, bounds, phone);
  assert.ok(intro.distance >= overview3D(bounds, phone).distance * INTRO_MIN_ZOOM_OUT - 1e-9);
});

test("the 3D overview looks from the camera side at the default elevation", () => {
  const view = overview3D(bounds, phone);
  assert.equal(view.azimuthRad, 0);
  assert.equal(view.elevationRad, ELEVATION_RAD);
  const position = cameraPosition({ target: { x_m: 1, y_m: 2 }, distance: 10, azimuthRad: 0, elevationRad: ELEVATION_RAD });
  near(position[0], 1, "x");
  assert.ok(position[2] > -2, "in front of the target on the metric -y side");
  near(Math.atan2(position[1], position[2] + 2), (65 * Math.PI) / 180, "elevation");
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

test("the ground scale at the target matches the projection", () => {
  const view = overview3D(bounds, phone);
  const [left] = projected(view, phone, view.target.x_m - 0.5, view.target.y_m);
  const [right] = projected(view, phone, view.target.x_m + 0.5, view.target.y_m);
  assert.ok(Math.abs(right - left - pixelsPerMetre(view.distance, phone.height)) < 1e-3);
});

test("the 2D overview fits the bounds inside the free viewport", () => {
  const view = overview2D(bounds, phone);
  const [x0, y0] = toScreen(view, phone, { x_m: bounds.minX, y_m: bounds.maxY });
  const [x1, y1] = toScreen(view, phone, { x_m: bounds.maxX, y_m: bounds.minY });
  assert.ok(x0 >= 8 && x1 <= 300 && y0 >= 8 && y1 <= 412);
  assert.ok(y0 < y1, "metric +y is up on screen");
});

test("a 2D focus puts the point in the middle of the free viewport", () => {
  const sheet = { width: 360, height: 640, insets: { top: 60, right: 12, bottom: 200, left: 12 } };
  const [x, y] = toScreen(centreOn2D({ x_m: 4, y_m: 9 }, 12, sheet), sheet, { x_m: 4, y_m: 9 });
  assert.ok(Math.abs(x - 180) < 1e-9 && Math.abs(y - 250) < 1e-9);
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

test("a pin that does not fit over its point hides instead of pointing elsewhere", () => {
  const entrance = { id: "entrance", x: 100, y: 100, width: 60, height: 20, priority: 100, minZoom: 0 };
  const pin = { id: "pin", x: 110, y: 104, width: 60, height: 40, priority: 90, minZoom: 0, pinned: true };
  assert.equal(placeLabels([entrance, pin], { width: 360, height: 400, zoom: 1 }).has("pin"), false);
  assert.deepEqual(placeLabels([pin], { width: 360, height: 400, zoom: 1 }).get("pin"), [110, 104]);
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

test("camera moves start and end exactly on their views", () => {
  const from2D = { center: { x_m: 0, y_m: 0 }, pxPerM: 2 };
  const to2D = { center: { x_m: 10, y_m: -4 }, pxPerM: 8 };
  assert.deepEqual(mix2D(from2D, to2D, 0), from2D);
  assert.deepEqual(mix2D(from2D, to2D, 1), to2D);
  // Halfway in log space: the geometric mean of the two scales.
  assert.ok(Math.abs(mix2D(from2D, to2D, 0.5).pxPerM - 4) < 1e-9);
  for (const ease of [easeInOut, easeOut]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
  }
});

test("a 3D move turns the short way round", () => {
  const from: View3D = { target: { x_m: 0, y_m: 0 }, distance: 50, azimuthRad: Math.PI - 0.1, elevationRad: ELEVATION_RAD };
  const to: View3D = { ...from, azimuthRad: -Math.PI + 0.1 };
  const halfway = mix3D(from, to, 0.5);
  assert.ok(Math.abs(Math.cos(halfway.azimuthRad) - Math.cos(Math.PI)) < 1e-9);
  assert.ok(Math.abs(mix3D(from, to, 1).azimuthRad - (Math.PI + 0.1)) < 1e-9);
});

test("reveal moves a hidden point just clear of what covers the map, and leaves a visible one", () => {
  // 800 px map, a 300 px sheet over the bottom: points must sit at or above 800 - 300 - 48 = 452.
  assert.equal(revealOffset(600, 800, 0, 300), 452 - 600);
  assert.equal(revealOffset(400, 800, 0, 300), 0);
  // A point under the top controls moves down.
  assert.equal(revealOffset(10, 800, 60, 300), 60 + 48 - 10);
  // When there is no free band left, nothing moves.
  assert.equal(revealOffset(600, 800, 400, 400), 0);
});

test("the near plane moves out with the camera, so distant flat layers keep their depth order", () => {
  assert.equal(nearPlane(5), 0.5);
  assert.equal(nearPlane(400), 12);
  // Close in, it never clips what the camera can reach: the closest view at the lowest tilt.
  const closest = overview3D({ minX: 0, minY: 0, maxX: 30, maxY: 20 }, { width: 390, height: 700, insets: NO_INSETS }).distance / MAX_ZOOM;
  assert.ok(nearPlane(closest) < closest * Math.sin(MIN_ELEVATION_RAD) / 4);
});
