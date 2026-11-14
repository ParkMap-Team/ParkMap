import assert from "node:assert/strict";
import { test } from "node:test";
import { revealRoute } from "./route-reveal.ts";

test("route reveal follows the distance along each leg without cutting the corner", () => {
  const route = [{ x_m: 0, y_m: 0 }, { x_m: 3, y_m: 0 }, { x_m: 3, y_m: 1 }];
  assert.deepEqual(revealRoute(route, 0.5), [route[0], { x_m: 2, y_m: 0 }]);
  assert.deepEqual(revealRoute(route, 0.875), [route[0], route[1], { x_m: 3, y_m: 0.5 }]);
  assert.equal(revealRoute(route, 1), route);
});
