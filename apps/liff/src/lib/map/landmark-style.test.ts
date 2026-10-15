import assert from "node:assert/strict";
import { test } from "node:test";
import { COLORS } from "../parking/presentation.ts";
import { landmarkTop, landmarkWall } from "./landmark-style.ts";

const STATUS_COLORS = new Set<string>([COLORS.AVAILABLE, COLORS.ALMOST_AVAILABLE, COLORS.OCCUPIED, COLORS.UNKNOWN, COLORS.UNMONITORED]);

test("a raised footprint shows its top from above, a flat one its ground colour", () => {
  assert.equal(landmarkTop({ kind: "BUILDING", height_m: 16 }), COLORS.ROOF);
  assert.equal(landmarkTop({ kind: "BUILDING" }), COLORS.BUILDING);
  assert.equal(landmarkTop({ kind: "PLANTING", height_m: 1 }), COLORS.PLANTING_RAISED);
  assert.equal(landmarkTop({ kind: "PLANTING", height_m: null }), COLORS.PLANTING);
  assert.equal(landmarkWall("BUILDING"), COLORS.FACADE);
});

test("no landmark is drawn in a status colour", () => {
  const kinds = ["ENTRANCE", "EXIT", "ENTRANCE_EXIT", "GUARD_BOOTH", "BUILDING", "AISLE", "BARRIER", "TREE", "ROAD", "WALKWAY", "PLANTING", "SHELTER"] as const;
  for (const kind of kinds) {
    for (const height_m of [null, 3]) assert.ok(!STATUS_COLORS.has(landmarkTop({ kind, height_m })), `${kind} top`);
    assert.ok(!STATUS_COLORS.has(landmarkWall(kind)), `${kind} wall`);
  }
});
