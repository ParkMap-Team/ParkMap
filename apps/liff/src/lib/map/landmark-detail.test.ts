import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricPolygon } from "../api/types.ts";
import { pointInPolygon } from "./geometry.ts";
import {
  ARROW,
  LANE,
  buildingTiers,
  boothTiers,
  edgeBand,
  edgeLines,
  frameHeading,
  frameOf,
  hash01,
  insetPolygon,
  laneArrows,
  laneDashes,
  offsetRing,
  planterTiers,
  shrubLayout,
} from "./landmark-detail.ts";

function rect(minX: number, minY: number, maxX: number, maxY: number): MetricPolygon {
  return [
    [
      { x_m: minX, y_m: minY },
      { x_m: maxX, y_m: minY },
      { x_m: maxX, y_m: maxY },
      { x_m: minX, y_m: maxY },
    ],
  ];
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

test("a ring moves inward by a positive distance and outward by a negative one, whichever way it winds", () => {
  const [ring] = rect(0, 0, 10, 4);
  for (const winding of [ring, [...ring].reverse()]) {
    const inner = offsetRing(winding, 1);
    close(Math.min(...inner.map((point) => point.x_m)), 1);
    close(Math.max(...inner.map((point) => point.y_m)), 3);
    const outer = offsetRing(winding, -0.5);
    close(Math.min(...outer.map((point) => point.x_m)), -0.5);
    close(Math.max(...outer.map((point) => point.y_m)), 4.5);
  }
});

test("a closing copy of the first point is ignored", () => {
  const [ring] = rect(0, 0, 2, 2);
  assert.equal(offsetRing([...ring, ring[0]], 0.5).length, 4);
});

test("shrinking a polygon past its width collapses it, and its holes grow", () => {
  assert.equal(insetPolygon(rect(0, 0, 10, 2), 1.2), null);
  assert.equal(insetPolygon(rect(0, 0, 10, 2), 3), null);
  const [outer, hole] = insetPolygon([...rect(0, 0, 10, 10), rect(4, 4, 6, 6)[0]], 1)!;
  close(Math.min(...outer.map((point) => point.x_m)), 1);
  close(Math.min(...hole.map((point) => point.x_m)), 3);
});

test("an edge band keeps the outer edge and cuts out the inside", () => {
  const band = edgeBand(rect(0, 0, 4, 2), 0.25)!;
  assert.equal(band.length, 2);
  assert.ok(pointInPolygon({ x_m: 0.1, y_m: 1 }, band));
  assert.ok(!pointInPolygon({ x_m: 2, y_m: 1 }, band));
  assert.equal(edgeBand(rect(0, 0, 4, 0.4), 0.25), null);
});

test("a frame runs along the longest edge", () => {
  const frame = frameOf([
    [
      { x_m: 0, y_m: 0 },
      { x_m: 0, y_m: 8 },
      { x_m: -2, y_m: 8 },
      { x_m: -2, y_m: 0 },
    ],
  ]);
  close(Math.abs(frameHeading(frame)), Math.PI / 2);
  close(frame.alongMax - frame.alongMin, 8);
  close(frame.acrossMax - frame.acrossMin, 2);
});

test("tiers stay within the recorded height", () => {
  const building = buildingTiers(55);
  assert.ok(building.groundM + building.parapetM < 55);
  assert.deepEqual(buildingTiers(4), { groundM: 0, parapetM: 0 });
  const booth = boothTiers(2.6);
  assert.ok(booth.sillM + booth.roofM < 2.6);
  for (const height of [0.4, 1, 3]) {
    const { kerbM, canopyM } = planterTiers(height);
    assert.ok(kerbM <= height / 2);
    close(kerbM + canopyM, height);
  }
});

test("shrubs fill a planting, inside it, the same way every time, and never oversized", () => {
  const planting = rect(-6.2, -2, 27.8, 0);
  const shrubs = shrubLayout("central-planters", planting);
  assert.ok(shrubs.length > 40, `${shrubs.length} shrubs`);
  assert.deepEqual(shrubLayout("central-planters", planting), shrubs);
  for (const shrub of shrubs) {
    assert.ok(pointInPolygon(shrub.point, planting));
    assert.ok(shrub.size > 0 && shrub.size <= 1);
    assert.ok(shrub.tint >= -0.5 && shrub.tint < 0.5);
  }
});

test("a huge planting is spaced wider so its shrub count stays bounded", () => {
  assert.ok(shrubLayout("field", rect(0, 0, 400, 400)).length <= 1600);
});

test("a road gets centre dashes along its length, clear of its ends; a narrow or short one gets none", () => {
  const road = rect(-13.5, -27.2, 43.5, -21.8);
  const dashes = laneDashes(road);
  assert.ok(dashes.length >= 8);
  for (const dash of dashes) {
    close(dash.center.y_m, -24.5);
    close(Math.abs(Math.cos(dash.headingRad)), 1);
    assert.ok(dash.center.x_m - LANE.dashM / 2 >= -13.5 + 2.7 - 1e-9);
    assert.ok(dash.center.x_m + LANE.dashM / 2 <= 43.5 - 2.7 + 1e-9);
  }
  assert.deepEqual(laneDashes(rect(0, 0, 40, 3)), []);
  assert.deepEqual(laneDashes(rect(0, 0, 9, 5)), []);
});

test("a road gets a solid line inside each long side, clear of its ends; a narrow or short one gets none", () => {
  const lines = edgeLines(rect(-13.5, -27.2, 43.5, -21.8));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.center.y_m).sort((a, b) => a - b).map((y) => Math.round(y * 1e9) / 1e9), [-26.9, -22.1]);
  for (const line of lines) {
    close(line.center.x_m, 15);
    close(line.lengthM, 57 - 5.4);
    close(line.widthM, LANE.edgeWidthM);
  }
  assert.deepEqual(edgeLines(rect(0, 0, 40, 3)), []);
  assert.deepEqual(edgeLines(rect(0, 0, 9, 5)), []);
});

test("a two-way road gets an arrow down each lane, the left lane heading along it, clear of its ends", () => {
  const arrows = laneArrows(rect(-13.5, -27.2, 43.5, -21.8));
  // 57 m long and 5.4 m wide: 46.2 m usable leaves room for four arrows 15 m apart in each lane.
  assert.equal(arrows.length, 8);
  for (const arrow of arrows) {
    assert.ok(arrow.center.x_m >= -13.5 + 5.4 - 1e-9 && arrow.center.x_m <= 43.5 - 5.4 + 1e-9);
    const heading = Math.cos(arrow.headingRad);
    close(Math.abs(heading), 1);
    // Keep left: eastbound in the north lane, westbound in the south lane.
    close(arrow.center.y_m, heading > 0 ? -23.15 : -25.85);
  }
  const xs = arrows.filter((arrow) => Math.cos(arrow.headingRad) > 0).map((arrow) => arrow.center.x_m);
  for (let index = 1; index < xs.length; index += 1) close(xs[index] - xs[index - 1], ARROW.spacingM);
  close((xs[0] + xs[xs.length - 1]) / 2, 15);
  assert.deepEqual(laneArrows(rect(0, 0, 40, 3)), []);
  assert.deepEqual(laneArrows(rect(0, 0, 9, 5)), []);
});

test("hashes are stable and in [0, 1)", () => {
  assert.equal(hash01("tree-1", 1), hash01("tree-1", 1));
  assert.notEqual(hash01("tree-1", 1), hash01("tree-1", 2));
  for (let salt = 0; salt < 50; salt += 1) {
    const value = hash01(`key-${salt}`, salt);
    assert.ok(value >= 0 && value < 1);
  }
});
