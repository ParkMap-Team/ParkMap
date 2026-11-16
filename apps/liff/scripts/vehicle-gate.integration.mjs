// Run after next build: node scripts/vehicle-gate.integration.mjs
// Real Next routes; only the external settings/vision services are controlled adapters.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

let selected = null;
let lastTokenType = null;
const upstream = http.createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/line/preferences") {
    lastTokenType = request.headers["x-line-token-type"];
    if (request.headers.authorization !== "Bearer synthetic-line-token") {
      response.writeHead(401); response.end("{}"); return;
    }
    if (request.method === "PUT") {
      let body = ""; for await (const chunk of request) body += chunk;
      selected = JSON.parse(body).model_id;
    }
    response.end(JSON.stringify({ model_id: selected, models: [{ id: "pcx", label: "pcx" }] }));
  } else {
    response.end(JSON.stringify({ site_id: "synthetic-site" }));
  }
});
upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
const base = "http://127.0.0.1:3027";
const processForTest = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3027"], {
  env: { ...process.env, PARKMAP_SETTINGS_URL: `http://127.0.0.1:${upstream.address().port}`,
    PARKMAP_API_URL: `http://127.0.0.1:${upstream.address().port}`, PARKMAP_PUBLIC_ORIGIN: base },
  stdio: "ignore",
});
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(base + "/help")).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Next must start");
  const state = base + "/api/sites/synthetic-site/parking-state";
  assert.equal((await fetch(state)).status, 403);
  assert.equal((await fetch(base + "/api/sites/sripatum/guard-booth-fit", { method: "POST" })).status, 403);
  assert.equal((await fetch(base + "/api/parking-areas/example/frame?v=1")).status, 403);
  assert.equal((await fetch(base + "/api/vehicle-preference", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" },
    body: JSON.stringify({ id_token: "synthetic-line-token" }) })).status, 403);
  const login = await fetch(base + "/api/vehicle-preference", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ id_token: "synthetic-line-token" }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/i);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  assert.equal((await fetch(state, { headers: { Cookie: cookie } })).status, 403);
  const saved = await fetch(base + "/api/vehicle-preference", { method: "PUT",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: "pcx" }) });
  assert.equal(saved.status, 200);
  const allowed = await fetch(state, { headers: { Cookie: cookie } });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).site_id, "synthetic-site");
  assert.match(allowed.headers.get("cache-control"), /private.*no-store/);
  const accessLogin = await fetch(base + "/api/vehicle-preference", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ access_token: "synthetic-line-token" }) });
  assert.equal(accessLogin.status, 200);
  const accessCookies = accessLogin.headers.getSetCookie().map(c => c.split(";", 1)[0]).join("; ");
  assert.match(accessCookies, /parkmap_line_token_type=access/);
  assert.equal((await fetch(state, { headers: { Cookie: accessCookies } })).status, 200);
  assert.equal(lastTokenType, "access");
  console.log("Vehicle gate integration passed: anonymous/unselected blocked, CSRF refused, saved account allowed.");
} finally {
  processForTest.kill(); upstream.close();
}
