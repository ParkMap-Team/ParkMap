import assert from "node:assert/strict";
import { test } from "node:test";
import type { LotModel } from "./api/types.ts";
import { boundsCenter } from "./map/geometry.ts";
import { parkedSpotInput, parkedSpotMap, savedAtLabel, spotRing } from "./parked-spot.ts";

const SPOT = { site_id: "sripatum", x_m: 12.5, y_m: -3.25 };

test("a spot with a site and a finite ground point is accepted as sent", () => {
  assert.deepEqual(parkedSpotInput(SPOT), SPOT);
});

test("a spot the settings service would refuse never leaves the app", () => {
  for (const value of [
    null, [], "sripatum", { ...SPOT, site_id: "Bad Site" }, { ...SPOT, site_id: "" }, { ...SPOT, x_m: "12" },
    { ...SPOT, x_m: Number.NaN }, { ...SPOT, y_m: Number.POSITIVE_INFINITY }, { ...SPOT, x_m: 10_001 },
    { ...SPOT, saved_at: "2026-11-18T00:00:00Z" }, { site_id: "sripatum", x_m: 1 },
  ]) assert.equal(parkedSpotInput(value), null, JSON.stringify(value));
});

test("the save time is printed in Thai time whatever the server's zone", () => {
  assert.match(savedAtLabel("2026-11-18T07:32:00+00:00"), /^บันทึกเมื่อ 18 .+ 14:32 น\.$/);
});

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [{ x_m: x0, y_m: y0 }, { x_m: x1, y_m: y0 }, { x_m: x1, y_m: y1 }, { x_m: x0, y_m: y1 }],
];

const lotModel: LotModel = {
  site_id: "sripatum",
  schema_version: 1,
  version: 1,
  outline: rect(0, 0, 40, 20),
  parking_areas: [{ parking_area_id: "near", polygon: rect(2, 1, 38, 19) }],
  unmonitored: [],
  landmarks: [{ landmark_id: "gate", kind: "ENTRANCE_EXIT", position: { x_m: 20, y_m: -2 }, measurement_source: "ESTIMATED" }],
};

// Near the far corner, where a frame fitted to the lot would put the pin against the top edge.
const CORNER = { site_id: "sripatum", x_m: 36, y_m: 17 };

test("the parked plan draws the parking areas as plain ground with no state", () => {
  const { areas } = parkedSpotMap(lotModel, CORNER, "spot");
  assert.equal(areas.length, 1);
  assert.deepEqual(areas[0].polygon, rect(2, 1, 38, 19));
  assert.equal(areas[0].live, null);
  assert.equal(areas[0].unknownReason, null);
  assert.deepEqual(areas[0].regions, []);
  assert.deepEqual(areas[0].motorcycles, []);
});

test("the close view frames the ground around the spot with the spot in the middle", () => {
  assert.deepEqual(parkedSpotMap(lotModel, CORNER, "spot").frame, { minX: 28, minY: 9, maxX: 44, maxY: 25 });
});

test("the whole-lot view keeps the lot and its way in on screen, still centred on the spot", () => {
  const { frame, bounds } = parkedSpotMap(lotModel, CORNER, "lot");
  assert.deepEqual(boundsCenter(frame), { x_m: 36, y_m: 17 });
  assert.ok(frame.minX <= bounds.minX && frame.minY <= -2 && frame.maxX >= bounds.maxX && frame.maxY >= bounds.maxY);
});

test("the ring marks the spot on the ground about a motorcycle's length across", () => {
  const [ring] = spotRing(CORNER);
  assert.ok(ring.length >= 16);
  for (const point of ring) assert.ok(Math.abs(Math.hypot(point.x_m - 36, point.y_m - 17) - 1.2) < 1e-9);
});
