import assert from "node:assert/strict";
import test from "node:test";
import { checkVehicleChange, vehicleChangeLocked } from "./vehicle-change-lock.ts";

test("an active recommendation blocks changing the vehicle", async () => {
  for (const stage of ["HELD", "AWAITING_CONFIRMATION"]) {
    assert.equal(vehicleChangeLocked({ stage }), true);
    assert.equal((await checkVehicleChange(async () => ({ stage })))?.status, 409);
  }
});
test("no recommendation or a finished recommendation allows changes", async () => {
  for (const value of [null, { stage: "RELEASED" }, { stage: "OCCUPIED_CONFIRMED" }]) {
    assert.equal(vehicleChangeLocked(value), false);
    assert.equal(await checkVehicleChange(async () => value), null);
  }
});
test("a failed recommendation check does not allow a vehicle change", async () => {
  assert.equal((await checkVehicleChange(async () => { throw new Error("offline"); }))?.status, 503);
});
