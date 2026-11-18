import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicBoothPath } from "./public-booth.ts";

test("only the Sripatum booth bypasses the LINE gate", () => {
  assert.equal(isPublicBoothPath("/sites/sripatum/guard-booth"), true);
  assert.equal(isPublicBoothPath("/sites/sripatum/guard-booth/"), true);
  for (const path of ["/", "/settings", "/sites/sripatum", "/sites/other/guard-booth", "/sites/sripatum/guard-booth/private"]) {
    assert.equal(isPublicBoothPath(path), false);
  }
});
