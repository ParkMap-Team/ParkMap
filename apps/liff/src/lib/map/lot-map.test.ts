import assert from "node:assert/strict";
import { test } from "node:test";
import type { LotModel, ParkingAreaLiveState } from "../api/types.ts";
import { buildLotMap, focusPoint, followSelection, hitTest, selectAt, summarize } from "./lot-map.ts";
import { areaLabel, headline, headlineStatus, landmarkLabel, mapLabels, unknownReasonText } from "./legend.ts";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [{ x_m: x0, y_m: y0 }, { x_m: x1, y_m: y0 }, { x_m: x1, y_m: y1 }, { x_m: x0, y_m: y1 }],
];

const lotModel: LotModel = {
  site_id: "site",
  schema_version: 1,
  version: 1,
  outline: rect(0, 0, 20, 10),
  parking_areas: [{ parking_area_id: "near", polygon: rect(2, 1, 18, 9) }],
  unmonitored: [rect(0, 0, 2, 10)],
  landmarks: [{ landmark_id: "hedge", kind: "BARRIER", name: "แนวพุ่มไม้", position: { x_m: 10, y_m: 12 }, line: [{ x_m: 0, y_m: 12 }, { x_m: 20, y_m: 12 }] }],
};

function live(overrides: Partial<ParkingAreaLiveState> = {}): ParkingAreaLiveState {
  return {
    parking_area_id: "near",
    status: "LIVE",
    source: "LIVE_CAMERA",
    observed_at: "2026-10-01T08:00:00Z",
    processed_at: "2026-10-01T08:00:01Z",
    age_s: 2,
    regions: [
      { kind: "AVAILABLE", row_id: "row_1", polygon: rect(3, 2, 5, 3) },
      { kind: "ALMOST_AVAILABLE", row_id: "row_1", polygon: rect(6, 2, 8, 3) },
      { kind: "UNKNOWN", row_id: "row_2", polygon: rect(3, 5, 17, 7) },
    ],
    motorcycles: [{ detection_id: "m1", center: { x_m: 12, y_m: 2.5 }, heading_rad: 0, length_m: 2, width_m: 0.66, confidence: 0.9 }],
    ...overrides,
  };
}

test("the map is framed on the outline and every landmark", () => {
  assert.deepEqual(buildLotMap(lotModel, null).bounds, { minX: 0, minY: 0, maxX: 20, maxY: 12 });
});

test("before the first answer every area is unknown and loading, never available", () => {
  const map = buildLotMap(lotModel, null);
  assert.equal(map.areas[0].unknownReason, "LOADING");
  assert.equal(hitTest(map, { x_m: 4, y_m: 2.5 })?.status, "UNKNOWN");
  assert.equal(summarize(map).loading, true);
});

test("an area without a current state shows no regions or motorcycles", () => {
  for (const status of ["STALE", "NO_DATA", "NOT_CALIBRATED", "CALIBRATION_MISMATCH"] as const) {
    const map = buildLotMap(lotModel, [live({ status })]);
    assert.equal(map.areas[0].unknownReason, status);
    assert.deepEqual(map.areas[0].regions, []);
    assert.deepEqual(map.areas[0].motorcycles, []);
    assert.equal(hitTest(map, { x_m: 4, y_m: 2.5 })?.status, "UNKNOWN");
    assert.match(unknownReasonText(status) ?? "", /./);
  }
});

test("an area missing from the answer has no data", () => {
  assert.equal(buildLotMap(lotModel, []).areas[0].unknownReason, "NO_DATA");
});

test("a tap finds the API's polygon under it, with motorcycles on top", () => {
  const map = buildLotMap(lotModel, [live()]);
  assert.equal(hitTest(map, { x_m: 4, y_m: 2.5 })?.status, "AVAILABLE");
  assert.equal(hitTest(map, { x_m: 7, y_m: 2.5 })?.status, "ALMOST_AVAILABLE");
  const unknown = hitTest(map, { x_m: 10, y_m: 6 });
  assert.equal(unknown?.status, "UNKNOWN");
  assert.equal(unknown?.unknownReason, "UNPROVEN");
  assert.equal(unknownReasonText("UNPROVEN"), null, "an UNKNOWN region carries no reason");
  assert.equal(hitTest(map, { x_m: 12.5, y_m: 2.6 })?.status, "OCCUPIED");
  assert.equal(hitTest(map, { x_m: 15, y_m: 8 })?.status, "MONITORED");
  assert.equal(hitTest(map, { x_m: 1, y_m: 5 })?.status, "UNMONITORED");
  assert.equal(hitTest(map, { x_m: 30, y_m: 5 }), null);
});

test("a demo area shows the same regions as a live one", () => {
  const map = buildLotMap(lotModel, [live({ status: "DEMO", source: "STILL_IMAGE_LOOP" })]);
  assert.equal(hitTest(map, { x_m: 4, y_m: 2.5 })?.status, "AVAILABLE");
});

test("a selection follows new data at the same point and reports a change", () => {
  const first = buildLotMap(lotModel, [live()]);
  const selection = selectAt(first, { x_m: 4, y_m: 2.5 });
  assert.deepEqual(selection, { point: { x_m: 4, y_m: 2.5 }, status: "AVAILABLE" });
  assert.equal(followSelection(first, selection!).change, null);
  const after = buildLotMap(lotModel, [live({ regions: [] })]);
  assert.deepEqual(followSelection(after, selection!).change, { from: "AVAILABLE", to: "MONITORED" });
  const stale = buildLotMap(lotModel, [live({ status: "STALE", regions: [], motorcycles: [] })]);
  assert.deepEqual(followSelection(stale, selection!).change, { from: "AVAILABLE", to: "UNKNOWN" });
  assert.equal(selectAt(first, { x_m: 50, y_m: 50 }), null);
});

test("focus points come from the API's own polygons", () => {
  const map = buildLotMap(lotModel, [live()]);
  assert.deepEqual(focusPoint(map, "AVAILABLE"), { x_m: 4, y_m: 2.5 });
  assert.deepEqual(focusPoint(map, "OCCUPIED"), { x_m: 12, y_m: 2.5 });
  assert.equal(focusPoint(buildLotMap(lotModel, [live({ regions: [] })]), "AVAILABLE"), null);
});

test("the summary counts detections and statuses, never free spaces", () => {
  const summary = summarize(buildLotMap(lotModel, [live()]));
  assert.deepEqual([...summary.present].sort(), ["ALMOST_AVAILABLE", "AVAILABLE", "OCCUPIED", "UNKNOWN", "UNMONITORED"]);
  assert.equal(summary.detectedMotorcycles, 1);
  assert.equal(summary.currentAreas, 1);
  assert.equal("availableSpaces" in summary, false);
});

test("the headline names what the map shows without a count or a promise", () => {
  const text = (states: ParkingAreaLiveState[] | null, lost = false) => headline(summarize(buildLotMap(lotModel, states)), lost);
  assert.equal(text([live()]), "มีพื้นที่จอด");
  assert.equal(text([live({ regions: [{ kind: "ALMOST_AVAILABLE", row_id: "r", polygon: rect(6, 2, 8, 3) }] })]), "อาจจอดได้หากมีการขยับรถ");
  assert.equal(text([live({ regions: [] })]), "ยังไม่พบพื้นที่จอดที่ยืนยันได้");
  assert.equal(text([live({ status: "STALE", regions: [] })]), "ยังยืนยันสถานะล่าสุดไม่ได้");
  assert.equal(text(null), "กำลังโหลดสถานะ");
  assert.equal(text(null, true), "เชื่อมต่อข้อมูลไม่ได้");
  for (const value of [text([live()]), text([live({ regions: [] })])]) assert.doesNotMatch(value, /\d|ช่อง|รับประกัน|จอง/);
});

test("the headline swatch matches the status it names and is absent otherwise", () => {
  const status = (states: ParkingAreaLiveState[] | null) => headlineStatus(summarize(buildLotMap(lotModel, states)));
  assert.equal(status([live()]), "AVAILABLE");
  assert.equal(status([live({ regions: [{ kind: "ALMOST_AVAILABLE", row_id: "r", polygon: rect(6, 2, 8, 3) }] })]), "ALMOST_AVAILABLE");
  assert.equal(status([live({ regions: [] })]), null);
  assert.equal(status([live({ status: "STALE", regions: [] })]), null);
  assert.equal(status(null), null);
});

test("labels come from the lot model only, with entrances named by kind", () => {
  const map = buildLotMap(lotModel, [live()]);
  assert.deepEqual(
    mapLabels(map).map((label) => label.text),
    ["แนวพุ่มไม้", "พื้นที่ตรวจสอบ"],
  );
  assert.equal(areaLabel(map, "near"), "พื้นที่ตรวจสอบ");
  const entrance = { landmark_id: "gate", kind: "ENTRANCE", position: { x_m: 0, y_m: 0 } } as const;
  assert.equal(landmarkLabel(entrance), "ทางเข้า");
  assert.equal(landmarkLabel({ ...entrance, kind: "EXIT", name: "ฝั่งถนน" }), "ทางออก ฝั่งถนน");
  assert.equal(landmarkLabel({ ...entrance, kind: "GUARD_BOOTH" }), "ป้อมยาม");
});
