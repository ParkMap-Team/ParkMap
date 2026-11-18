import assert from "node:assert/strict";
import { test } from "node:test";
import { parkingRequestBody } from "./request-body.ts";

test("parking mutations reject a cross-origin request and an oversized body", async () => {
  const headers = { origin: "http://localhost:3001" };
  const previous = process.env.PARKMAP_PUBLIC_ORIGIN;
  process.env.PARKMAP_PUBLIC_ORIGIN = "http://localhost:3001";
  try {
    assert.deepEqual(await parkingRequestBody(new Request("http://localhost:3001/api/test", { method: "POST", headers, body: '{"request_id":"opaque"}' })), { request_id: "opaque" });
    await assert.rejects(parkingRequestBody(new Request("http://localhost:3001/api/test", { method: "POST", headers: { origin: "http://other.example" }, body: "{}" })));
    await assert.rejects(parkingRequestBody(new Request("http://localhost:3001/api/test", { method: "POST", headers, body: JSON.stringify({ extra: "x".repeat(4096) }) })));
    await assert.rejects(parkingRequestBody(new Request("http://localhost:3001/api/test", { method: "POST", headers, body: "invalid" })));
  } finally {
    if (previous === undefined) delete process.env.PARKMAP_PUBLIC_ORIGIN;
    else process.env.PARKMAP_PUBLIC_ORIGIN = previous;
  }
});
