import assert from "node:assert/strict";
import test from "node:test";
import { selectedReservationInput } from "./selected-reservation.ts";

const selected = { target: { x_m: 6.5, y_m: 1 }, parking_area_id: "area-1", observed_at: "2026-11-27T10:00:00Z", lot_model_version: 1 };
test("a selected point carries its area and observed frame, without browser model decisions", () => {
  assert.deepEqual(selectedReservationInput({ ...selected, family: "untrusted", owner_key: "untrusted" }), selected);
});
test("incomplete, non-finite and oversized selections are rejected", () => {
  for (const value of [null, {}, { target: selected.target }, { ...selected, observed_at: "invalid" },
    { ...selected, target: { x_m: NaN, y_m: 1 } }, { ...selected, target: { x_m: Infinity, y_m: 1 } },
    { ...selected, target: { x_m: 10_001, y_m: 1 } }, { ...selected, parking_area_id: "" },
    { ...selected, lot_model_version: 0 }, { ...selected, lot_model_version: 1.5 }]) {
    assert.equal(selectedReservationInput(value), null);
  }
});
