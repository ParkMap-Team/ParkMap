"""Offline keyboard-driven review queue for curate.py findings. It exports a review.json in the
schema prepare.py --review accepts (merged onto the review the snapshot applied) plus a decision log for the record."""

import json
from pathlib import Path

# Pure function kept in its own block so tests can run it under Node and validate its output with prepare.load_review.
BUILD_REVIEW_JS = r"""
const REASONS = {
  same: "ตรวจด้วยตา: รูปซ้ำหรือรถคันเดียวกัน ต้องอยู่ split เดียวกัน",
  distinct: "ตรวจด้วยตา: เป็นรถคนละคัน",
  uncertain: "ตรวจด้วยตา: ไม่แน่ใจว่าเป็นคันเดียวกัน",
  keep: "ตรวจด้วยตา: label ถูกต้อง",
  relabel: "ตรวจด้วยตา: แก้ label เป็นรุ่นที่ถูกต้อง",
  exclude: "ตรวจด้วยตา: ตัดออก รูปหรือ label ไม่ชัดเจน",
  quality_keep: "",
  quality_exclude: "ตรวจด้วยตา: ตัดออก คุณภาพรูปต่ำ",
};

function pairKey(a, b) { return [a, b].sort().join("|"); }

// base: an existing review.json; items: queue items; decisions: {itemId: {action, canonical_class?, reason}}.
function buildReview(base, items, decisions) {
  const review = JSON.parse(JSON.stringify(base || {}));
  review.version = 1;
  review.annotations = review.annotations || {};
  review.images = review.images || {};
  review.same_vehicle_groups = review.same_vehicle_groups || [];
  review.similar_pairs = review.similar_pairs || [];
  const groups = new Set(review.same_vehicle_groups.map((g) => [...g].sort().join("|")));
  const pairs = new Map(review.similar_pairs.map((p) => [pairKey(p.images[0], p.images[1]), p]));
  const annotate = (id, fields) => { review.annotations[id] = Object.assign({}, review.annotations[id], fields); };
  for (const item of items) {
    const d = decisions[item.id];
    if (!d) continue;
    const reason = (d.reason || REASONS[d.action] || "").trim();
    const [a, b] = item.crops;
    if (item.kind === "pair") {
      if (d.action === "same") {
        const group = [a.annotation_id, b.annotation_id].sort();
        if (!groups.has(group.join("|"))) { groups.add(group.join("|")); review.same_vehicle_groups.push(group); }
      }
      // Only image pairs found by preparation (dHash) are read back as similar-pair decisions; embedding
      // pairs are still recorded so the review file documents every checked pair.
      const decision = { same: "same_vehicle_grouped", distinct: "distinct", uncertain: "uncertain" }[d.action];
      pairs.set(pairKey(a.image_id, b.image_id), { images: [a.image_id, b.image_id].sort(), decision, reason });
    } else if (d.action === "keep") {
      annotate(a.annotation_id, { confirmed: true, reason });
    } else if (d.action === "relabel") {
      annotate(a.annotation_id, { canonical_class: d.canonical_class, confirmed: true, reason });
    } else if (d.action === "exclude" || d.action === "quality_exclude") {
      annotate(a.annotation_id, { exclude: true, reason });
    }
  }
  review.similar_pairs = [...pairs.values()];
  return review;
}

// Decisions prepare.py cannot apply while a source keeps its pinned splits.
function needsResplit(item, d) {
  if (!d) return false;
  const [a, b] = item.crops;
  if (item.kind === "pair") return d.action === "same" && a.pinned && b.pinned && a.split !== b.split;
  return a.pinned && ["relabel", "exclude", "quality_exclude"].includes(d.action);
}

if (typeof module !== "undefined") module.exports = { buildReview, needsResplit, REASONS };
"""

PAGE = r"""<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dataset Review Queue</title>
<style>
:root { --bg:#f6f6f4; --panel:#fff; --text:#1d1d1b; --muted:#6b6b66; --line:#deded8; --accent:#2457c5;
  --same:#b03a2e; --ok:#23733f; --warn:#9a6700; --chip:#ecece6; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#171716; --panel:#222220; --text:#ecece6;
  --muted:#a3a39b; --line:#3a3a36; --accent:#7ea2ff; --same:#ff8a7a; --ok:#6fd38f; --warn:#f0c04f; --chip:#2e2e2b; } }
:root[data-theme="dark"] { --bg:#171716; --panel:#222220; --text:#ecece6; --muted:#a3a39b; --line:#3a3a36;
  --accent:#7ea2ff; --same:#ff8a7a; --ok:#6fd38f; --warn:#f0c04f; --chip:#2e2e2b; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui, sans-serif; }
header { position:sticky; top:0; z-index:2; background:var(--panel); border-bottom:1px solid var(--line); padding:10px 16px; }
h1 { font-size:16px; margin:0 0 6px; }
.row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
button, select, input[type=text] { font:inherit; color:var(--text); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:5px 10px; }
button { cursor:pointer; } button.on { border-color:var(--accent); color:var(--accent); font-weight:600; }
input[type=text] { min-width:0; flex:1 1 320px; }
.muted { color:var(--muted); } .warn { color:var(--warn); font-weight:600; }
main { max-width:1200px; margin:0 auto; padding:16px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
.crops { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; margin:12px 0; }
figure { margin:0; } figure img { width:100%; height:300px; object-fit:contain; background:var(--chip); border-radius:6px; }
figcaption { font-size:12px; margin-top:4px; word-break:break-all; }
.chip { display:inline-block; background:var(--chip); border-radius:4px; padding:0 6px; margin:0 4px 2px 0; }
.examples { display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:6px; }
.examples img { width:100%; height:110px; object-fit:contain; background:var(--chip); border-radius:4px; }
.actions button { min-width:120px; }
.status-same { color:var(--same); } .status-done { color:var(--ok); }
kbd { border:1px solid var(--line); border-bottom-width:2px; border-radius:4px; padding:0 4px; font-size:12px; }
.list { margin-top:16px; display:flex; flex-wrap:wrap; gap:4px; }
.list button { padding:2px 6px; min-width:44px; font-size:12px; }
.list button.done { color:var(--ok); } .list button.current { border-color:var(--accent); }
@media (max-width:600px) { figure img { height:220px; } .actions button { min-width:0; flex:1 1 40%; } }
</style>
</head>
<body>
<header>
  <h1>Dataset review queue <span class="muted" id="fingerprint"></span></h1>
  <div class="row" id="tabs"></div>
  <div class="row" style="margin-top:6px">
    <label><input type="checkbox" id="undecided" checked> เฉพาะที่ยังไม่ตัดสิน</label>
    <span id="progress" class="muted"></span>
    <span style="flex:1"></span>
    <label class="muted">นำเข้า log <input type="file" id="log" accept=".json"></label>
    <button id="export">Export review.json</button>
    <button id="export-log">Export decisions log</button>
  </div>
  <div id="base-status" class="muted" style="font-size:12px"></div>
</header>
<main>
  <div id="view" class="card"></div>
  <p class="muted" id="help"></p>
  <div class="list" id="list"></div>
</main>
<script type="application/json" id="payload">__PAYLOAD__</script>
<script id="build-review">__BUILD_REVIEW__</script>
<script>
"use strict";
const DATA = JSON.parse(document.getElementById("payload").textContent);
const STORE = "parkmap-review:" + DATA.fingerprint;
const KINDS = { pair: "รูปซ้ำข้าม split", label: "label น่าสงสัย", quality: "คุณภาพรูป" };
const ACTIONS = {
  pair: [["same", "S", "คันเดียวกัน"], ["distinct", "D", "คนละคัน"], ["uncertain", "U", "ไม่แน่ใจ"]],
  label: [["keep", "K", "label ถูก"], ["relabel", "A", "เปลี่ยนเป็นที่แนะนำ"], ["exclude", "X", "ตัดออก"]],
  quality: [["quality_keep", "K", "เก็บไว้"], ["quality_exclude", "X", "ตัดออก"]],
};
let state = { decisions: {} };
try { state = Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { /* storage unavailable */ }
// A decision made on this page wins; otherwise the one an earlier round recorded in the applied review.
const decisionOf = (item) => state.decisions[item.id] || item.prior;
let kind = "pair", position = 0, dirty = false;
const save = () => { dirty = true; try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ } };
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") node.className = v; else if (k.startsWith("on")) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v); }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
};
const queue = () => DATA.items.filter((i) => i.kind === kind && (!document.getElementById("undecided").checked || !decisionOf(i) || i === current()));
let currentId = null;
const current = () => DATA.items.find((i) => i.id === currentId);

function figure(crop, caption) {
  const img = el("img", { src: crop.src, alt: crop.annotation_id, loading: "lazy" });
  const link = crop.source_src ? el("a", { href: crop.source_src, target: "_blank", rel: "noopener" }, "รูปเต็ม") : null;
  return el("figure", {}, img, el("figcaption", {},
    caption ? el("strong", {}, caption + " ") : null,
    el("span", { class: "chip" }, crop.label), el("span", { class: "chip" }, crop.split),
    el("span", { class: "chip" }, crop.source + (crop.pinned ? " (pinned)" : "")),
    el("span", { class: "chip" }, crop.size.join("x")), link, el("br"), el("span", { class: "muted" }, crop.annotation_id)));
}

function examples(title, crops) {
  return el("div", {}, el("p", { class: "muted" }, title), el("div", { class: "examples" },
    ...crops.map((c) => el("img", { src: c.src, alt: c.label, title: c.annotation_id + " " + c.split, loading: "lazy" }))));
}

function decide(action, extra = {}) {
  const item = current();
  if (!item) return;
  if (item.kind === "pair" && action === "same" && item.multi_crop) { alert("รูปนี้มีหลายคัน ใช้ \"ไม่แน่ใจ\" แล้วจัดกลุ่มใน gallery หลักแทน"); return; }
  // An empty reason means the default for the action; only a typed reason is stored.
  const reasonBox = document.getElementById("reason");
  const decision = { action, reason: reasonBox ? reasonBox.value.trim() : "", decided_at: new Date().toISOString(), ...extra };
  if (action === "relabel" && !decision.canonical_class) decision.canonical_class = item.suggested;
  state.decisions[item.id] = decision;
  save();
  move(1);
}

function move(step) {
  const items = queue();
  if (!items.length) { currentId = null; render(); return; }
  let index = items.findIndex((i) => i.id === currentId);
  index = index < 0 ? 0 : Math.min(Math.max(index + step, 0), items.length - 1);
  currentId = items[index].id;
  render();
}

function render() {
  const view = document.getElementById("view");
  const items = queue();
  if (!current() || current().kind !== kind) currentId = items.length ? items[0].id : null;
  const all = DATA.items.filter((i) => i.kind === kind);
  const done = all.filter(decisionOf).length;
  const resplit = DATA.items.filter((i) => needsResplit(i, state.decisions[i.id])).length;
  document.getElementById("progress").textContent = `${done}/${all.length} ตัดสินแล้ว` + (resplit ? ` | ${resplit} รายการต้อง re-split แบบไม่ pin` : "");
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(...Object.entries(KINDS).map(([k, label]) => {
    const total = DATA.items.filter((i) => i.kind === k).length;
    const left = DATA.items.filter((i) => i.kind === k && !decisionOf(i)).length;
    return el("button", { class: k === kind ? "on" : "", onclick: () => { kind = k; currentId = null; render(); } }, `${label} (${left} เหลือ / ${total})`);
  }));
  const item = current();
  if (!item) { view.replaceChildren(el("p", {}, all.length ? "ตัดสินครบแล้วในหมวดนี้" : "ไม่มีรายการในหมวดนี้")); renderList(all); return; }
  const d = state.decisions[item.id], shown = decisionOf(item);
  const head = el("div", { class: "row" }, el("strong", {}, `${all.indexOf(item) + 1} / ${all.length}`),
    el("span", { class: "chip" }, item.method ? `${item.method} ${item.score}` : `score ${item.score}`),
    shown ? el("span", { class: "status-done" }, (d ? "ตัดสินแล้ว: " : "ตัดสินรอบก่อน: ") + shown.action + (shown.canonical_class ? " -> " + shown.canonical_class : ""))
      : el("span", { class: "muted" }, "ยังไม่ตัดสิน"),
    needsResplit(item, d) ? el("span", { class: "warn" }, "ต้อง re-split: source นี้ pin splits ไว้") : null);
  const parts = [head];
  if (item.kind === "pair") {
    parts.push(el("p", { class: "muted" }, "สองรูปนี้อยู่คนละ split ถ้าเป็นรถคันเดียวกัน/รูปเดียวกัน (แม้ crop หรือมุมต่างเล็กน้อย) ให้กด S เพื่อให้อยู่ split เดียวกัน รุ่นเดียวกันแต่คนละคัน = D"));
    if (item.multi_crop) parts.push(el("p", { class: "warn" }, "รูปต้นฉบับมีหลาย crop ดูรูปเต็มก่อน; จัดกลุ่มรายคันใน gallery หลัก"));
    parts.push(el("div", { class: "crops" }, figure(item.crops[0], "A"), figure(item.crops[1], "B")));
    if (item.extra && item.extra.length) parts.push(examples("crop อื่นในรูปเดียวกัน", item.extra));
  } else if (item.kind === "label") {
    parts.push(el("p", {}, `label ปัจจุบัน `, el("strong", {}, item.crops[0].label), ` (probe ${item.score}) | แนะนำ `,
      el("strong", {}, item.suggested), ` (${item.suggested_probability})`));
    parts.push(el("div", { class: "crops" }, figure(item.crops[0], "ตรวจ"),
      el("div", {}, examples(`ตัวอย่าง ${item.suggested} ที่คล้ายที่สุด (รูปอื่น)`, item.suggested_examples),
        examples(`ตัวอย่าง ${item.crops[0].label} ที่คล้ายที่สุด (รูปอื่น)`, item.given_examples))));
  } else {
    parts.push(el("p", {}, "CleanVision พบ: ", ...item.issues.map((i) => el("span", { class: "chip" }, i)),
      el("span", { class: "muted" }, " ตัดออกเฉพาะรูปที่ดูไม่ออกว่าเป็นรุ่นอะไร")));
    parts.push(el("div", { class: "crops" }, figure(item.crops[0], "")));
  }
  const reason = el("input", { type: "text", id: "reason", placeholder: "เหตุผล (เว้นว่าง = ใช้ค่าเริ่มต้น)" });
  reason.value = d ? d.reason || "" : "";
  const actions = el("div", { class: "row actions" }, ...ACTIONS[item.kind].map(([action, key, label]) =>
    el("button", { class: shown && shown.action === action ? "on" : "", onclick: () => decide(action) }, el("kbd", {}, key), " " + label)));
  if (item.kind === "label") {
    const select = el("select", { "aria-label": "เลือก class อื่น" }, el("option", { value: "" }, "class อื่น..."),
      ...DATA.classes.map((c) => el("option", { value: c }, c)));
    select.addEventListener("change", () => { if (select.value) decide("relabel", { canonical_class: select.value }); });
    actions.append(select);
  }
  if (d) actions.append(el("button", { onclick: () => { delete state.decisions[item.id]; save(); render(); } }, "ล้าง"));
  parts.push(actions, el("div", { class: "row", style: "margin-top:8px" }, reason));
  view.replaceChildren(...parts);
  renderList(all);
}

function renderList(all) {
  const list = document.getElementById("list");
  list.replaceChildren(...all.map((i, n) => el("button", {
    class: (decisionOf(i) ? "done " : "") + (i.id === currentId ? "current" : ""),
    title: i.id, onclick: () => { currentId = i.id; render(); } }, String(n + 1))));
}

function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = el("a", { href: url, download: name });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readJson(input, apply) {
  const file = input.files[0];
  if (!file) return;
  file.text().then((text) => apply(JSON.parse(text), file.name)).catch((e) => alert("อ่านไฟล์ไม่ได้: " + e.message));
}

document.getElementById("log").addEventListener("change", (e) => readJson(e.target, (value) => {
  if (value.fingerprint !== DATA.fingerprint) throw new Error("log นี้เป็นของ snapshot อื่น");
  Object.assign(state.decisions, Object.fromEntries(value.decisions.map(({ id, ...d }) => [id, d]))); save(); render();
}));
document.getElementById("export").addEventListener("click", () => {
  download("review.json", buildReview(DATA.base, DATA.items, state.decisions)); dirty = false;
});
document.getElementById("export-log").addEventListener("click", () => {
  download("decisions.json", { fingerprint: DATA.fingerprint, audit_run: DATA.audit_run, exported_at: new Date().toISOString(),
    decisions: DATA.items.filter((i) => state.decisions[i.id]).map((i) => ({ id: i.id, kind: i.kind,
      annotations: i.crops.map((c) => c.annotation_id), needs_resplit: needsResplit(i, state.decisions[i.id]), ...state.decisions[i.id] })) });
  dirty = false;
});
function showBase() {
  const prior = DATA.items.filter((i) => i.prior).length;
  document.getElementById("base-status").textContent = `${prior}/${DATA.items.length} รายการตัดสินไว้แล้วในรอบก่อน (ซ่อนไว้; เอาติ๊กออกเพื่อดูหรือแก้). `
    + "Export review.json รวมการตัดสินเดิมของ snapshot นี้ให้อัตโนมัติ";
}
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toUpperCase();
  if (key === "ARROWRIGHT" || key === "J") return move(1);
  if (key === "ARROWLEFT") return move(-1);
  const item = current();
  if (!item) return;
  const match = ACTIONS[item.kind].find(([, k]) => k === key);
  if (match) { e.preventDefault(); decide(match[0]); }
});
document.getElementById("undecided").addEventListener("change", render);
document.getElementById("fingerprint").textContent = DATA.fingerprint;
document.getElementById("help").replaceChildren("คีย์ลัด: ", el("kbd", {}, "→"), "/", el("kbd", {}, "J"), " ถัดไป, ",
  el("kbd", {}, "←"), " ก่อนหน้า, ปุ่มตัวอักษรตามที่แสดงบนปุ่ม. บันทึกอัตโนมัติในเบราว์เซอร์นี้; กด Export decisions log เพื่อสำรอง/ย้ายเครื่อง.");
showBase();
render();
</script>
</body>
</html>
"""


PRIOR_PAIR_ACTIONS = {"same_vehicle_grouped": "same", "distinct": "distinct", "uncertain": "uncertain"}


def prior_decisions(items, review):
    """Attach to each queue item the decision an earlier round recorded in `review`, the inverse of buildReview.

    Quality "keep" leaves no record in the review schema, so those items are asked again."""
    pairs = {frozenset(p["images"]): p for p in review["similar_pairs"]}
    groups = [set(g) for g in review["same_vehicle_groups"]]
    for item in items:
        a = item["crops"][0]
        prior = None
        if item["kind"] == "pair":
            b = item["crops"][1]
            pair = pairs.get(frozenset((a["image_id"], b["image_id"])))
            if pair and pair.get("decision") in PRIOR_PAIR_ACTIONS:
                prior = {"action": PRIOR_PAIR_ACTIONS[pair["decision"]], "reason": pair.get("reason", "")}
            elif any(a["annotation_id"] in g and b["annotation_id"] in g for g in groups):
                prior = {"action": "same", "reason": ""}
        else:
            entry = review["annotations"].get(a["annotation_id"], {})
            if entry.get("exclude"):
                prior = {"action": "exclude" if item["kind"] == "label" else "quality_exclude"}
            elif item["kind"] == "label" and entry.get("canonical_class"):
                prior = {"action": "relabel", "canonical_class": entry["canonical_class"]}
            elif item["kind"] == "label" and entry.get("confirmed"):
                prior = {"action": "keep"}
            if prior:
                prior["reason"] = entry.get("reason", "")
        if prior:
            item["prior"] = prior
    return items


def render_review(path, items, classes, report, base):
    """Write the standalone review page; image links stay relative to the prepared snapshot.

    `base` is the review the snapshot applied; the export merges new decisions onto it."""
    payload = {"fingerprint": report["dataset"]["fingerprint"], "audit_run": Path(path).parent.name, "base": base,
               "classes": classes, "items": items}
    # Escaping "<" keeps "</script>" in any string from closing the JSON block.
    text = PAGE.replace("__PAYLOAD__", json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c"))
    Path(path).write_text(text.replace("__BUILD_REVIEW__", BUILD_REVIEW_JS), encoding="utf-8")
