import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOT_STEPS, progressFill } from "./boot-progress.ts";

test("the bar shows a sliver before any step finishes", () => {
  assert.equal(progressFill(0, BOOT_STEPS.length), 0.08);
});

test("the bar fills by finished steps and is full only when all are done", () => {
  assert.equal(progressFill(1, 2), 0.5);
  assert.equal(progressFill(2, 2), 1);
  assert.ok(progressFill(BOOT_STEPS.length - 1, BOOT_STEPS.length) < 1);
});
