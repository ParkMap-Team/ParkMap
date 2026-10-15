import assert from "node:assert/strict";
import { test } from "node:test";
import { Euler, Vector3 } from "three";
import type { MotorcycleProxy } from "../api/types.ts";
import { axisHeading, boundsOf, edgePoints, labelPoint, pointInPolygon, proxyFootprint, toWorld } from "./geometry.ts";
import { motorcycleTransform } from "./motorcycle-model.ts";

const square = [[{ x_m: 0, y_m: 0 }, { x_m: 4, y_m: 0 }, { x_m: 4, y_m: 4 }, { x_m: 0, y_m: 4 }]];
const withHole = [...square, [{ x_m: 1, y_m: 1 }, { x_m: 3, y_m: 1 }, { x_m: 3, y_m: 3 }, { x_m: 1, y_m: 3 }]];

function proxy(overrides: Partial<MotorcycleProxy> = {}): MotorcycleProxy {
  return { detection_id: "d1", center: { x_m: 5, y_m: 3 }, heading_rad: 0, length_m: 2, width_m: 0.66, confidence: 0.9, ...overrides };
}

test("points inside a hole are outside the polygon", () => {
  assert.equal(pointInPolygon({ x_m: 0.5, y_m: 0.5 }, withHole), true);
  assert.equal(pointInPolygon({ x_m: 2, y_m: 2 }, withHole), false);
  assert.equal(pointInPolygon({ x_m: 5, y_m: 2 }, withHole), false);
});

test("a label point always lies inside its polygon", () => {
  assert.deepEqual(labelPoint(square), { x_m: 2, y_m: 2 });
  const ring = [[{ x_m: 0, y_m: 0 }, { x_m: 6, y_m: 0 }, { x_m: 6, y_m: 1 }, { x_m: 1, y_m: 1 }, { x_m: 1, y_m: 6 }, { x_m: 0, y_m: 6 }]];
  assert.equal(pointInPolygon(labelPoint(ring), ring), true);
});

test("bounds cover every point", () => {
  assert.deepEqual(boundsOf(square[0]), { minX: 0, minY: 0, maxX: 4, maxY: 4 });
});

test("edge points mark every corner and split long edges evenly", () => {
  const strip = [[{ x_m: 0, y_m: 0 }, { x_m: 9, y_m: 0 }, { x_m: 9, y_m: 2 }, { x_m: 0, y_m: 2 }]];
  assert.deepEqual(edgePoints(strip, 5), [
    { x_m: 0, y_m: 0 },
    { x_m: 4.5, y_m: 0 },
    { x_m: 9, y_m: 0 },
    { x_m: 9, y_m: 2 },
    { x_m: 4.5, y_m: 2 },
    { x_m: 0, y_m: 2 },
  ]);
});

test("a heading and its opposite fold onto the same axis", () => {
  assert.equal(axisHeading(Math.PI), 0);
  assert.ok(Math.abs(axisHeading(-Math.PI / 4) - axisHeading((3 * Math.PI) / 4)) < 1e-9);
  assert.equal(axisHeading(Math.PI / 2), Math.PI / 2);
  assert.equal(axisHeading(-Math.PI / 2), Math.PI / 2);
});

test("a proxy footprint is the API rectangle around its centre", () => {
  const corners = proxyFootprint(proxy({ heading_rad: Math.PI / 2 }))[0];
  const xs = corners.map((point) => point.x_m);
  const ys = corners.map((point) => point.y_m);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.66) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 2) < 1e-9);
  assert.equal(pointInPolygon({ x_m: 5, y_m: 3.9 }, [corners]), true);
});

test("metric ground maps to world x and -z", () => {
  assert.deepEqual(toWorld({ x_m: 2, y_m: 3 }, 1), [2, 1, -3]);
});

test("the model's long axis lands on the proxy's long axis in the world", () => {
  for (const heading of [0, 0.4, Math.PI / 2, -1.2, Math.PI]) {
    const transform = motorcycleTransform(proxy({ heading_rad: heading }));
    const forward = new Vector3(1, 0, 0).applyEuler(new Euler(0, transform.rotationY, 0));
    // World (x, -z) is metric (x, y); the axis may point either way.
    const dot = forward.x * Math.cos(heading) + -forward.z * Math.sin(heading);
    assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-9, `heading ${heading}`);
  }
});

test("the model is stretched onto the standard footprint and stands on the ground", () => {
  const transform = motorcycleTransform(proxy());
  assert.deepEqual(transform.position, [5, 0, -3]);
  assert.ok(Math.abs(transform.scale[0] * 1.86 - 2) < 1e-9);
  assert.ok(Math.abs(transform.scale[2] * 0.68 - 0.66) < 1e-9);
  assert.equal(transform.scale[1], transform.scale[0]);
});
