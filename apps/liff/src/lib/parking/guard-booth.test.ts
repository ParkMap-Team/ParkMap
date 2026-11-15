import assert from "node:assert/strict";
import { test } from "node:test";
import type { LotModel, MetricPolygon, ParkingAreaLiveState } from "../api/types.ts";
import { buildLotMap } from "../map/lot-map.ts";
import { activeParkingHolds, applyParkingHolds, guardBoothHeadline, guardBoothPreviewDestination, PARKING_HOLD_MS, sripatumPreviewRoute } from "./guard-booth.ts";

const polygon: MetricPolygon = [[{ x_m: 0, y_m: 0 }, { x_m: 2, y_m: 0 }, { x_m: 2, y_m: 2 }, { x_m: 0, y_m: 2 }]];
const lot: LotModel = { schema_version: 1, site_id: "test", version: 1, outline: polygon, unmonitored: [], parking_areas: [{ parking_area_id: "area", polygon }] };
const area: ParkingAreaLiveState = { parking_area_id: "area", status: "LIVE", regions: [{ kind: "ALMOST_AVAILABLE", polygon }, { kind: "AVAILABLE", polygon }] };

test("a two-minute hold blocks overlapping placements for the next rider", () => {
  const nearby = (offset: number): MetricPolygon => polygon.map((ring) => ring.map(({ x_m, y_m }) => ({ x_m: x_m + offset, y_m })));
  const map = buildLotMap(lot, [{ ...area, regions: [0, 1, 2].map((offset) => ({ kind: "AVAILABLE", polygon: nearby(offset) })) }]);
  const holds = [{ areaId: "area", polygon, expiresAt: 120_000 }];
  assert.equal(PARKING_HOLD_MS, 120_000);
  assert.deepEqual(applyParkingHolds(map, activeParkingHolds(map, holds, 119_999)).areas[0].regions.map((region) => region.polygon), [nearby(2)]);
  assert.equal(applyParkingHolds(map, activeParkingHolds(map, holds, 120_000)).areas[0].regions.length, 3);
  const stale = buildLotMap(lot, [{ ...area, status: "STALE" }]);
  assert.equal(applyParkingHolds(stale, activeParkingHolds(stale, holds, 120_000)).areas[0].regions.length, 0);
});

test("only a current, confirmed occupancy takes over from a hold early", () => {
  const holds = [{ areaId: "area", polygon, expiresAt: PARKING_HOLD_MS }];
  const motorcycles = [{ detection_id: "m1", center: { x_m: 1, y_m: 1 }, heading_rad: 0, length_m: 2, width_m: 0.66, confidence: 0.9 }];
  const occupied = buildLotMap(lot, [{ ...area, motorcycles, regions: [] }]);
  assert.equal(activeParkingHolds(occupied, holds, 1_000).length, 0);

  const uncertain = buildLotMap(lot, [{ ...area, motorcycles, regions: [{ kind: "UNKNOWN", polygon }] }]);
  assert.equal(activeParkingHolds(uncertain, holds, 1_000).length, 1);
  assert.equal(applyParkingHolds(uncertain, holds).areas[0].regions[0].kind, "UNKNOWN");

  const conflicting = buildLotMap(lot, [{ ...area, motorcycles }]);
  assert.equal(activeParkingHolds(conflicting, holds, 1_000).length, 1);
  assert.equal(applyParkingHolds(conflicting, holds).areas[0].regions.length, 0);
});

test("the TV gives directions only when current data supports the requested guidance", () => {
  assert.equal(guardBoothHeadline("preview", false, true, true), "ยังยืนยันพื้นที่ว่างไม่ได้");
  assert.equal(guardBoothHeadline("preview", true, true, true), "ไปตามเส้นสีน้ำเงิน");
  assert.equal(guardBoothHeadline("preview", true, true, false), "จอดตรงจุดที่ลูกศรชี้");
  assert.equal(guardBoothHeadline("unknown", true, true, false), "ดูพื้นที่ว่างสีเขียว");
  assert.equal(guardBoothHeadline("unknown", true, false, false), "ไม่พบพื้นที่ว่างที่ยืนยันได้");
});

test("only the known preview marks an Available point on the shared lot map", () => {
  const map = buildLotMap(lot, [area]);
  assert.deepEqual(guardBoothPreviewDestination(map, "preview")?.point, { x_m: 1, y_m: 1 });
  assert.equal(guardBoothPreviewDestination(map, "waiting"), null);
  assert.equal(guardBoothPreviewDestination(map, "unknown"), null);
});

test("stale or advisory regions cannot become the preview destination", () => {
  const stale = buildLotMap(lot, [{ ...area, status: "STALE" }]);
  const advisory = buildLotMap(lot, [{ ...area, regions: [{ kind: "ALMOST_AVAILABLE", polygon }] }]);
  assert.equal(guardBoothPreviewDestination(stale, "preview"), null);
  assert.equal(guardBoothPreviewDestination(advisory, "preview"), null);
});

test("the sample route connects the Sripatum entrance and the selected placement only with synthetic data", () => {
  const entrance = { x_m: 21.5, y_m: -21 };
  const destination = { x_m: 11, y_m: 6 };
  const sripatum: LotModel = { ...lot, landmarks: [{ landmark_id: "entrance-1", kind: "ENTRANCE", position: entrance, measurement_source: "ESTIMATED" }] };
  const sample = buildLotMap(sripatum, [{ ...area, source: "SYNTHETIC_FIXTURE" }]);
  const route = sripatumPreviewRoute(sample, "sripatum", destination);
  assert.deepEqual(route?.[0], entrance);
  assert.deepEqual(route?.at(-1), destination);
  assert.equal(sripatumPreviewRoute(sample, "sripatum", undefined), undefined);
  assert.equal(sripatumPreviewRoute(buildLotMap(sripatum, [{ ...area, source: "LIVE_CAMERA" }]), "sripatum", destination), undefined);
});
