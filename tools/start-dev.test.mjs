import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const launcher = fileURLToPath(new URL("../start-dev.bat", import.meta.url));

function runAt(script, args, env = process.env) {
  const result = spawnSync(process.env.ComSpec ?? "cmd.exe", [
    "/d", "/s", "/c", `""${script}" ${args.join(" ")}"`,
  ], {
    cwd: tmpdir(),
    encoding: "utf8",
    windowsVerbatimArguments: true,
    windowsHide: true,
    timeout: 15_000,
    env,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

const run = (...args) => runAt(launcher, args);

function withNativeTools(callback) {
  const fixture = mkdtempSync(join(tmpdir(), "ParkMap native tools test "));
  try {
    for (const path of ["tools", "bin", "node_modules", "apps/liff/node_modules",
      "tools/calibration-ui/node_modules", "apps/vision-api/.venv/Scripts"]) {
      mkdirSync(join(fixture, path), { recursive: true });
    }
    copyFileSync(launcher, join(fixture, "start-dev.bat"));
    copyFileSync(join(dirname(launcher), "tools/start-dev.ps1"), join(fixture, "tools/start-dev.ps1"));
    writeFileSync(join(fixture, "apps/vision-api/.env"), "");
    writeFileSync(join(fixture, "apps/vision-api/.venv/Scripts/python.exe"), "");
    writeFileSync(join(fixture, "bin/pnpm.cmd"), "@exit /b 0\r\n");
    const source = join(fixture, "NativeTool.cs");
    writeFileSync(source, `
using System;
public class NativeTool {
    public static int Main(string[] args) {
        if (args[0] == "info") {
            Console.Error.WriteLine("WARNING: No blkio throttle.read_bps_device support");
            return int.Parse(Environment.GetEnvironmentVariable("TEST_DOCKER_INFO_EXIT") ?? "0");
        }
        if (args[0] == "compose") {
            Console.WriteLine("COMPOSE_REACHED");
            Console.WriteLine("LOCAL_IPV4_DATABASE=" + (Environment.GetEnvironmentVariable("DATABASE_URL") == "postgresql://parkmap:parkmap@127.0.0.1:5432/parkmap"));
            Console.WriteLine("LOCAL_IPV4_API=" + (Environment.GetEnvironmentVariable("PARKMAP_API_URL") == "http://127.0.0.1:8000"));
            Console.Error.WriteLine("WARNING: native compose warning");
            return 0;
        }
        Console.WriteLine("MIGRATIONS_REACHED");
        Console.Error.WriteLine("Controlled migration failure");
        return 29;
    }
}`);
    const compiler = join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    const built = spawnSync(compiler, ["/nologo", `/out:${join(fixture, "bin/docker.exe")}`, source], {
      encoding: "utf8", windowsHide: true, timeout: 15_000,
    });
    assert.ifError(built.error);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    copyFileSync(join(fixture, "bin/docker.exe"), join(fixture, "bin/uv.exe"));
    const env = { ...process.env, TEST_DOCKER_INFO_EXIT: "0" };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    env[pathKey ?? "PATH"] = `${join(fixture, "bin")};${join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0")}`;
    callback(join(fixture, "start-dev.bat"), env);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("Windows launcher works outside the repository and keeps existing site data", {
  skip: process.platform !== "win32",
}, () => {
  const result = run("--dry-run");
  assert.equal(result.status, 0, result.output);
  for (const service of ["Postgres", "Vision API", "LIFF", "Calibration UI"]) {
    assert.ok(result.output.includes(service), result.output);
  }
  assert.match(result.output, /up -d --wait postgres/);
  assert.match(result.output, /alembic upgrade head/);
  assert.match(result.output, /Calibration UI: http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(result.output, /seed-dev|publish-dev-state/);
});

test("synthetic data and its publisher require explicit demo mode", {
  skip: process.platform !== "win32",
}, () => {
  const result = run("--demo", "--dry-run", "--no-browser");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /seed-dev/);
  assert.match(result.output, /publish-dev-state/);
  assert.doesNotMatch(result.output, /Browser:/);
});

test("invalid options fail before any services are started", {
  skip: process.platform !== "win32",
}, () => {
  const result = run("--unknown");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Unknown option: --unknown/);
  assert.doesNotMatch(result.output, /Waiting for/);
});

for (const runner of ["pnpm.cmd", "npm.cmd"]) {
  test(`missing backend configuration gives an actionable error with ${runner} and no Corepack`, {
    skip: process.platform !== "win32",
  }, () => {
    const fixture = mkdtempSync(join(tmpdir(), "ParkMap launcher's test "));
    try {
      for (const path of ["tools", "bin", "node_modules", "apps/liff/node_modules",
        "tools/calibration-ui/node_modules", "apps/vision-api/.venv/Scripts"]) {
        mkdirSync(join(fixture, path), { recursive: true });
      }
      copyFileSync(launcher, join(fixture, "start-dev.bat"));
      copyFileSync(join(dirname(launcher), "tools/start-dev.ps1"), join(fixture, "tools/start-dev.ps1"));
      // These names satisfy command discovery only. The missing .env must abort before any executes.
      for (const tool of ["docker.exe", "uv.exe", runner]) {
        writeFileSync(join(fixture, "bin", tool), "");
      }
      writeFileSync(join(fixture, "apps/vision-api/.venv/Scripts/python.exe"), "");
      const env = { ...process.env };
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
      env[pathKey ?? "PATH"] = `${join(fixture, "bin")};${join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0")}`;
      const result = runAt(join(fixture, "start-dev.bat"), ["--no-browser"], env);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /Copy apps\\vision-api\\\.env\.example/);
      assert.doesNotMatch(result.output, /Waiting for/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test("Docker stderr warnings with exit zero allow startup to reach migrations", {
  skip: process.platform !== "win32",
}, (t) => {
  withNativeTools((script, env) => {
    const result = runAt(script, ["--no-browser"], env);
    if (/ERROR: Port \d+ is already in use/.test(result.output)) {
      t.skip('Native integration test requires free app ports (3000, 3001, 8000).');
      return;
    }
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /\[2\/5\] Applying database migrations/);
    assert.match(result.output, /COMPOSE_REACHED/);
    assert.match(result.output, /LOCAL_IPV4_DATABASE=True/);
    assert.match(result.output, /LOCAL_IPV4_API=True/);
    assert.match(result.output, /MIGRATIONS_REACHED/);
    assert.match(result.output, /Command failed \(exit 29\)/);
    assert.doesNotMatch(result.output, /ERROR: WARNING:/);
  });
});

test("a real Docker failure still stops startup before compose", {
  skip: process.platform !== "win32",
}, (t) => {
  withNativeTools((script, env) => {
    const result = runAt(script, ["--no-browser"], { ...env, TEST_DOCKER_INFO_EXIT: "9" });
    if (/ERROR: Port \d+ is already in use/.test(result.output)) {
      t.skip('Native integration test requires free app ports (3000, 3001, 8000).');
      return;
    }
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Docker is not ready\. Open Docker Desktop/);
    assert.doesNotMatch(result.output, /COMPOSE_REACHED|MIGRATIONS_REACHED/);
  });
});
