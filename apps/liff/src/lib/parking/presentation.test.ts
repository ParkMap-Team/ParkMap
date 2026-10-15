import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParkingAreaLiveState, SiteParkingState } from "../api/types.ts";
import { agoLabel, photoTimeLabel, showsRegions, sourceBadge, sourceNotice, timeLines, visibleAreas } from "./presentation.ts";

const square = [[{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }, { x_m: 1, y_m: 1 }]];

function liveArea(overrides: Partial<ParkingAreaLiveState> = {}): ParkingAreaLiveState {
  return {
    parking_area_id: "area-1",
    status: "LIVE",
    source: "LIVE_CAMERA",
    observed_at: "2026-10-01T08:00:00Z",
    age_s: 5,
    regions: [{ kind: "AVAILABLE", row_id: "row_1", polygon: square }],
    motorcycles: [],
    ...overrides,
  };
}

function siteState(...areas: ParkingAreaLiveState[]): SiteParkingState {
  return { site_id: "site", generated_at: "2026-10-01T08:00:05Z", freshness_limit_s: 15, areas };
}

test("a live area stays live while its age is within the limit", () => {
  const [area] = visibleAreas(siteState(liveArea()), 4);
  assert.equal(area.status, "LIVE");
  assert.equal(area.age_s, 9);
  assert.equal(area.regions?.length, 1);
});

test("a live area becomes stale without regions once the answer ages past the limit", () => {
  const [area] = visibleAreas(siteState(liveArea()), 11);
  assert.equal(area.status, "STALE");
  assert.deepEqual(area.regions, []);
  assert.deepEqual(area.motorcycles, []);
});

test("a clock that runs backwards never keeps an area live", () => {
  assert.equal(visibleAreas(siteState(liveArea()), -1)[0].status, "STALE");
});

test("areas the API did not mark live are never upgraded", () => {
  const stale = liveArea({ status: "STALE", regions: [] });
  assert.equal(visibleAreas(siteState(stale), 0)[0].status, "STALE");
});

test("recorded and synthetic sources are always announced", () => {
  assert.equal(sourceNotice([liveArea()]), null);
  assert.match(sourceNotice([liveArea(), liveArea({ source: "RECORDED_REPLAY" })]) ?? "", /วิดีโอที่บันทึกไว้/);
  assert.match(sourceNotice([liveArea({ source: "RECORDED_REPLAY" }), liveArea({ source: "SYNTHETIC_FIXTURE" })]) ?? "", /ข้อมูลจำลอง/);
});

function demoArea(overrides: Partial<ParkingAreaLiveState> = {}): ParkingAreaLiveState {
  return liveArea({ status: "DEMO", source: "STILL_IMAGE_LOOP", observed_at: "2026-09-25T02:31:00Z", ...overrides });
}

test("a demo area stays a demo while its processing is fresh and becomes stale without regions after", () => {
  assert.equal(visibleAreas(siteState(demoArea()), 4)[0].status, "DEMO");
  const [stale] = visibleAreas(siteState(demoArea()), 11);
  assert.equal(stale.status, "STALE");
  assert.deepEqual(stale.regions, []);
});

test("only live and demo areas show their regions", () => {
  assert.equal(showsRegions("LIVE"), true);
  assert.equal(showsRegions("DEMO"), true);
  for (const status of ["STALE", "NO_DATA", "NOT_CALIBRATED", "CALIBRATION_MISMATCH"] as const) {
    assert.equal(showsRegions(status), false);
  }
});

test("a still-image loop is always announced as recorded demo photos", () => {
  assert.match(sourceNotice([liveArea(), demoArea()]) ?? "", /ภาพถ่ายที่บันทึกไว้/);
  assert.match(sourceNotice([demoArea({ status: "STALE", regions: [] })]) ?? "", /ภาพถ่ายที่บันทึกไว้/);
  assert.match(sourceNotice([liveArea({ source: "RECORDED_REPLAY" }), demoArea()]) ?? "", /ภาพถ่ายที่บันทึกไว้/);
  assert.match(sourceNotice([demoArea(), liveArea({ source: "SYNTHETIC_FIXTURE" })]) ?? "", /ข้อมูลจำลอง/);
});

test("the photo time of a demo is shown in Bangkok time", () => {
  assert.match(photoTimeLabel("2026-09-25T02:31:00Z"), /09:31/);
});

test("a lost connection drops current regions even within the freshness limit", () => {
  const [area] = visibleAreas(siteState(liveArea(), demoArea({ parking_area_id: "area-2" })), 1, true).slice(0, 1);
  assert.equal(area.status, "STALE");
  assert.deepEqual(area.regions, []);
  assert.equal(visibleAreas(siteState(demoArea()), 1, true)[0].status, "STALE");
});

test("the source badge never calls recorded photos live", () => {
  assert.equal(sourceBadge([demoArea()]), "ข้อมูลสาธิต");
  assert.equal(sourceBadge([liveArea(), demoArea()]), "ข้อมูลสาธิต");
  assert.equal(sourceBadge([liveArea({ source: "RECORDED_REPLAY" })]), "วิดีโอบันทึก");
  assert.equal(sourceBadge([liveArea({ source: "SYNTHETIC_FIXTURE" }), demoArea()]), "ข้อมูลจำลอง");
  assert.equal(sourceBadge([liveArea()]), "กล้องสด");
  assert.equal(sourceBadge([liveArea({ status: "NO_DATA", source: null })]), null);
});

test("photo, processing, and receipt times are kept apart", () => {
  const received = Date.parse("2026-10-01T08:00:09Z");
  const lines = timeLines(demoArea({ processed_at: "2026-10-01T08:00:05Z" }), received);
  assert.deepEqual(lines.map((line) => line.label), ["ภาพถ่าย", "ประมวลผล", "รับข้อมูล"]);
  assert.match(lines[0].value, /09:31/);
  assert.match(lines[0].value, /2569|2026/, "a still-image photo shows its date");
  assert.match(lines[1].value, /15:00:05/);
  assert.match(lines[2].value, /15:00:09/);
  assert.equal(timeLines(liveArea({ processed_at: "2026-10-01T08:00:01Z" }), null)[0].label, "ภาพจากกล้อง");
  assert.deepEqual(timeLines(null, null), []);
});

test("ages read in seconds, minutes, then hours", () => {
  assert.equal(agoLabel(4.4), "4 วินาทีที่แล้ว");
  assert.equal(agoLabel(-2), "0 วินาทีที่แล้ว");
  assert.equal(agoLabel(125), "2 นาทีที่แล้ว");
  assert.equal(agoLabel(7300), "2 ชั่วโมงที่แล้ว");
});
