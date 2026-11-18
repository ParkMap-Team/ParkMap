import assert from "node:assert/strict";
import { test } from "node:test";
import { legendRows } from "./legend.ts";
import type { MapStatus } from "./lot-map.ts";

const rows = (present: MapStatus[]) => legendRows(new Set(present)).map(({ status, present }) => `${status}:${present}`);

test("an empty map still shows the compact key, with nothing to find", () => {
  assert.deepEqual(rows([]), ["AVAILABLE:false", "ALMOST_AVAILABLE:false", "OCCUPIED:false", "UNMONITORED:false"]);
});

test("statuses outside the compact key join it only while the map shows them", () => {
  assert.deepEqual(rows(["AVAILABLE", "UNKNOWN"]), ["AVAILABLE:true", "ALMOST_AVAILABLE:false", "OCCUPIED:false", "UNKNOWN:true", "UNMONITORED:false"]);
});

test("width-only green replaces available instead of sitting beside an empty available row", () => {
  assert.deepEqual(rows(["WIDTH_SUFFICIENT", "OCCUPIED"]), ["WIDTH_SUFFICIENT:true", "ALMOST_AVAILABLE:false", "OCCUPIED:true", "UNMONITORED:false"]);
  assert.deepEqual(rows(["AVAILABLE", "WIDTH_SUFFICIENT"]).slice(0, 2), ["AVAILABLE:true", "WIDTH_SUFFICIENT:true"]);
});
