import assert from "node:assert/strict";
import { test } from "node:test";
import { legendRows } from "./legend.ts";
import type { MapStatus } from "./lot-map.ts";

const rows = (present: MapStatus[]) => legendRows(new Set(present)).map(({ status, present }) => `${status}:${present}`);

test("an empty map still shows the key, with nothing to find", () => {
  assert.deepEqual(rows([]), ["AVAILABLE:false", "OCCUPIED:false", "UNMONITORED:false"]);
});

test("the key never names live state a rider's map does not paint", () => {
  assert.deepEqual(rows(["AVAILABLE", "WIDTH_SUFFICIENT", "ALMOST_AVAILABLE", "UNKNOWN", "MONITORED", "OCCUPIED"]), ["AVAILABLE:true", "OCCUPIED:true", "UNMONITORED:false"]);
});

test("free ground is one row, named for the free status a tap on it reports", () => {
  assert.deepEqual(rows(["WIDTH_SUFFICIENT"]), ["WIDTH_SUFFICIENT:true", "OCCUPIED:false", "UNMONITORED:false"]);
});
