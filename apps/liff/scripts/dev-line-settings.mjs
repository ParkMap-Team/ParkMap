// Development only: a stand-in for the LINE settings service (`app.line_bot`), so the LIFF app runs in
// a desktop browser without LINE. It accepts only the token VehicleGate sends when
// NEXT_PUBLIC_PARKMAP_DEV_LINE_LOGIN=1, listens on loopback only, and keeps the choice in memory.
// Usage: node scripts/dev-line-settings.mjs, then run the app with PARKMAP_SETTINGS_URL=http://127.0.0.1:3091.
import http from "node:http";

const TOKEN = "local-dev-line-token";
const PORT = Number(process.env.PORT ?? 3091);
// The IDs and labels of MODEL_LABELS in apps/vision-api/app/services/line_motorcycle_settings.py.
const MODELS = Object.entries({
  click: "Honda Click", aerox: "Yamaha Aerox", nmax: "Yamaha NMAX", scoopy: "Honda Scoopy",
  wave: "Honda Wave", pcx: "Honda PCX", fino: "Yamaha Fino", forza: "Honda Forza",
  grand_filano: "Yamaha Grand Filano", hd_road_glide: "Harley-Davidson Road Glide",
  cbr650r: "Honda CBR650R", xmax: "Yamaha XMAX", other: "ไม่ระบุ",
}).map(([id, label]) => ({ id, label }));
let selected = null;

const server = http.createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url !== "/api/line/preferences" || (request.method !== "GET" && request.method !== "PUT")) {
    response.writeHead(404).end(JSON.stringify({ detail: "Not found." }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end(JSON.stringify({ detail: "Invalid LINE identity." }));
    return;
  }
  if (request.method === "PUT") {
    let body = "";
    for await (const chunk of request) body += chunk;
    let model;
    try { model = JSON.parse(body).model_id; } catch { /* rejected below */ }
    if (!MODELS.some(({ id }) => id === model)) {
      response.writeHead(422).end(JSON.stringify({ detail: "Unknown model." }));
      return;
    }
    selected = model;
  }
  response.end(JSON.stringify({ model_id: selected, models: MODELS }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Development LINE settings stand-in on http://127.0.0.1:${PORT} (not LINE; choices reset on restart)`);
});
