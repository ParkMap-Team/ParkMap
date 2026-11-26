import assert from "node:assert/strict";
import test from "node:test";
import { preferenceResponse } from "./preference-response.ts";

test("opening probe accepts an absent session without an HTTP error", async () => {
  const response = preferenceResponse(null, true);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("protected preference reads still require authentication", () => {
  assert.equal(preferenceResponse(null, false).status, 401);
});

test("a verified preference remains available to the opening probe", async () => {
  const data = { model_id: "test-model" };
  const response = preferenceResponse(data, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), data);
});
