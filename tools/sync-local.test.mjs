import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { localDatabase } from "./sync-local.mjs";

const script = fileURLToPath(new URL("./sync-local.mjs", import.meta.url));

function dryRun(databaseUrl) {
  const result = spawnSync(process.execPath, [script, "--dry-run"], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test("the plan migrates, restores without overwriting, fetches weights and verifies last", () => {
  const result = dryRun("postgresql://parkmap:secret-password@127.0.0.1:5432/parkmap");
  assert.equal(result.status, 0, result.output);
  const order = ["pnpm install --frozen-lockfile", "uv sync --locked --all-groups", "alembic upgrade head",
    "restore-seed-calibration --parking-area-id sripatum-near-lot --output-dir config",
    "scripts/download_segmentation_weights.py", "app.manage verify-setup"];
  const positions = order.map((step) => result.output.indexOf(step));
  assert.ok(positions.every((position) => position >= 0), result.output);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(result.output, /Database: 127\.0\.0\.1:5432\/parkmap/);
  assert.doesNotMatch(result.output, /secret-password/);
});

test("a database on another machine is refused before anything runs, without its credentials", () => {
  const result = dryRun("postgresql://parkmap:secret-password@db.example.com:5432/parkmap");
  assert.equal(result.status, 1);
  assert.match(result.output, /Refusing database host db\.example\.com/);
  assert.doesNotMatch(result.output, /secret-password|\[1\/6\]/);
});

test("local hosts are accepted and an invalid URL is rejected", () => {
  assert.equal(localDatabase("postgresql://u:p@localhost/parkmap"), "localhost:5432/parkmap");
  assert.equal(localDatabase("postgresql://u:p@[::1]:6543/parkmap"), "[::1]:6543/parkmap");
  assert.throws(() => localDatabase("not a url"), /not a valid URL/);
});
