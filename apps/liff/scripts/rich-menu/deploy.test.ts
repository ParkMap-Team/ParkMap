import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPT = fileURLToPath(new URL("./deploy.ts", import.meta.url));

// Both cases fail before any request to LINE.
function deploy(env: Record<string, string>) {
  const { LINE_CHANNEL_ACCESS_TOKEN: _token, PRODUCTION_LIFF_ID: _liffId, ...inherited } = process.env;
  return spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
    env: { ...inherited, ...env },
    encoding: "utf8",
  });
}

test("a missing token exits non-zero", () => {
  const result = deploy({ PRODUCTION_LIFF_ID: "1234567890-AbCdEfGh" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LINE_CHANNEL_ACCESS_TOKEN/);
});

test("a failure never prints the token", () => {
  const token = "token-that-must-not-be-printed";
  const result = deploy({ LINE_CHANNEL_ACCESS_TOKEN: token, PRODUCTION_LIFF_ID: "not-a-liff-id" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRODUCTION_LIFF_ID/);
  assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
});
