import assert from "node:assert/strict";
import { test } from "node:test";
import { upstreamFailureStatus } from "./server.ts";

test("unknown or invalid sites are not found and other failures are upstream errors", () => {
  assert.equal(upstreamFailureStatus(404), 404);
  assert.equal(upstreamFailureStatus(422), 404);
  assert.equal(upstreamFailureStatus(503), 503);
  assert.equal(upstreamFailureStatus(500), 502);
});
