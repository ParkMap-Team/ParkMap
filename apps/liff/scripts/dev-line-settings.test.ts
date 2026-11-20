import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("local LINE stand-in supplies a stable recommendation owner and saved model", async () => {
  const child = spawn(process.execPath, ["scripts/dev-line-settings.mjs"], {
    env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [chunk] = await once(child.stdout!, "data", { signal: AbortSignal.timeout(5000) });
    const port = String(chunk).match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert(port && port !== "0");
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: "Bearer local-dev-line-token", "Content-Type": "application/json" };
    assert.equal((await fetch(base + "/api/line/recommendation-owner")).status, 401);
    const first = await fetch(base + "/api/line/recommendation-owner", { headers });
    assert.equal(first.status, 200);
    const owner = await first.json();
    assert.match(owner.owner_key, /^[0-9a-f]{64}$/);
    assert.equal(owner.model_id, null);
    assert.equal((await fetch(base + "/api/line/preferences", {
      method: "PUT", headers, body: JSON.stringify({ model_id: "pcx" }),
    })).status, 200);
    const updated = await (await fetch(base + "/api/line/recommendation-owner", { headers })).json();
    assert.equal(updated.owner_key, owner.owner_key);
    assert.equal(updated.model_id, "pcx");
  } finally {
    child.kill();
  }
});
