import assert from "node:assert/strict";
import { test } from "node:test";
import { parkedSpotInput, savedAtLabel } from "./parked-spot.ts";

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
