// Brings a local checkout to exactly this version: dependencies, schema, shared Sripatum setup,
// calibration files and segmentation weights, then verifies all of it. Never overwrites differing
// calibration files and refuses any database that is not on this machine.
//
//   node tools/sync-local.mjs [--dry-run]
//
// The database is DATABASE_URL from the environment, else from apps/vision-api/.env, as the API uses.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apiRoot = join(repoRoot, "apps", "vision-api");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const steps = [
  ["Install frontend dependencies", repoRoot, "pnpm", ["install", "--frozen-lockfile"]],
  ["Install Vision API dependencies", apiRoot, "uv", ["sync", "--locked", "--all-groups"]],
  ["Apply database migrations", apiRoot, "uv", ["run", "--no-sync", "python", "-m", "alembic", "upgrade", "head"]],
  ["Restore shared calibration files (never overwrites)", apiRoot, "uv", ["run", "--no-sync", "python", "-m", "app.manage", "restore-seed-calibration", "--parking-area-id", "sripatum-near-lot", "--output-dir", "config"]],
  ["Download pinned segmentation weights", apiRoot, "uv", ["run", "--no-sync", "python", "scripts/download_segmentation_weights.py"]],
  ["Verify setup matches this version", apiRoot, "uv", ["run", "--no-sync", "python", "-m", "app.manage", "verify-setup"]],
];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(apiRoot, ".env");
  if (!existsSync(envFile)) throw new Error("Copy apps/vision-api/.env.example to apps/vision-api/.env and configure it first.");
  const url = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL in apps/vision-api/.env first.");
  return url;
}

/** The database target without credentials, or an error if it is not on this machine. */
export function localDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing database host ${parsed.hostname}: this script only changes a database on this machine.`);
  }
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}

function main(args) {
  const unknown = args.filter((arg) => arg !== "--dry-run");
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")}. Usage: node tools/sync-local.mjs [--dry-run]`);
  console.log(`Database: ${localDatabase(databaseUrl())}`);
  steps.forEach(([title, cwd, command, commandArgs], index) => {
    console.log(`[${index + 1}/${steps.length}] ${title}: ${command} ${commandArgs.join(" ")}`);
    if (args.includes("--dry-run")) return;
    // pnpm and uv are .cmd shims on Windows, which only a shell can start; every argument is a fixed literal.
    const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${title} failed (exit ${result.status}). See the output above; later steps did not run.`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
