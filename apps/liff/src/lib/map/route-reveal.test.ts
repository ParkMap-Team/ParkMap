import assert from "node:assert/strict";
import { test } from "node:test";
import { revealRoute, routeArrow } from "./route-reveal.ts";
import { parkingRibbon } from "./parking-ribbon.ts";

test("the 3D ribbon rounds corners, has a raised surface and keeps both route ends", () => {
  const route = [{ x_m: 1, y_m: 2 }, { x_m: 5, y_m: 2 }, { x_m: 5, y_m: 6 }];
  const ribbon = parkingRibbon(route, 0.08)!;
  assert.ok(ribbon.length > 7.5 && ribbon.length < 8);
  const vertices = Array.from({ length: ribbon.positions.length / 3 }, (_, index) => ribbon.positions.slice(index * 3, index * 3 + 3));
  assert.equal(vertices[0][0], 1);
  assert.equal(vertices.at(-1)?.[2], -6);
  assert.ok(vertices.some(([, height]) => height > vertices[0][1] + 0.05));
  assert.equal(ribbon.uvs[0], 0);
  assert.ok(Math.abs(ribbon.uvs.at(-2)! - ribbon.length) < 0.00001);
  assert.equal(parkingRibbon([route[0], route[0]], 0.08), null);
});

test("route reveal follows the distance along each leg without cutting the corner", () => {
  const route = [{ x_m: 0, y_m: 0 }, { x_m: 3, y_m: 0 }, { x_m: 3, y_m: 1 }];
  assert.deepEqual(revealRoute(route, 0.5), [route[0], { x_m: 2, y_m: 0 }]);
  assert.deepEqual(revealRoute(route, 0.875), [route[0], route[1], { x_m: 3, y_m: 0.5 }]);
  assert.equal(revealRoute(route, 1), route);
});

test("the arrow points left after a left turn and follows the corner as it turns", () => {
  const start = { x_m: 3, y_m: 0 };
  const corner = { x_m: 3, y_m: 4 };
  const justAfterTurn = { x_m: 2.65, y_m: 4 };
  const turningArrow = routeArrow([start, corner, justAfterTurn]);
  assert.ok(turningArrow);
  assert.equal(turningArrow[1], justAfterTurn);
  assert.ok((turningArrow[0].y_m + turningArrow[2].y_m) / 2 < justAfterTurn.y_m);
  const tip = { x_m: 1, y_m: 4 };
  const leftArrow = routeArrow([start, corner, tip]);
  assert.ok(leftArrow);
  assert.ok(leftArrow[0].x_m > tip.x_m && leftArrow[2].x_m > tip.x_m);
});
