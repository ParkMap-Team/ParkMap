import assert from "node:assert/strict";
import { test } from "node:test";
import type { GuardBoothRider, LotModel, MetricPolygon, ParkingAreaLiveState } from "../api/types.ts";
import { buildLotMap } from "../map/lot-map.ts";
import { boothFitStatus, canRetryBoothFit } from "./guard-booth.ts";
import { activeParkingHolds, activeRiders, applyParkingHolds, arrivedRider, CLASSIFICATION_RETRY_MAX_MS, classificationRetryMs, enqueueRider, entranceClipCrop, entranceClipOutcome, guardBoothFitFamily, guardBoothFrame, guardBoothHeadline, guardBoothModelName, guardBoothPreviewDestination, PARKING_HOLD_MS, RIDER_COLORS, RIDER_QUEUE_LIMIT, RIDER_QUEUE_MS, riderGuide, riderTitle, routeRiderSeq, sripatumPreviewRoute } from "./guard-booth.ts";

const polygon: MetricPolygon = [[{ x_m: 0, y_m: 0 }, { x_m: 2, y_m: 0 }, { x_m: 2, y_m: 2 }, { x_m: 0, y_m: 2 }]];

test("a released hold starts a new search only for the same request and current photo", () => {
  const released = { request_id: "first", observed_at: "photo", stage: "RELEASED", reason: "RELEASED", polygon: null } as const;
  assert.equal(canRetryBoothFit(released, "first", "photo"), true);
  assert.equal(canRetryBoothFit(released, "second", "photo"), false);
  assert.equal(canRetryBoothFit(released, "first", "other-photo"), false);
  assert.equal(boothFitStatus(released, false), "pending");
  assert.equal(boothFitStatus({ ...released, stage: "OCCUPIED_CONFIRMED", reason: "OCCUPIED_CONFIRMED" }, false), "occupied");
  assert.equal(boothFitStatus({ ...released, stage: null, reason: "NO_FIT" }, false), "no-space");
  assert.equal(boothFitStatus({ ...released, stage: "AWAITING_CONFIRMATION", reason: "AWAITING_CONFIRMATION" }, true), "confirming");
});
const lot: LotModel = { schema_version: 1, site_id: "test", version: 1, outline: polygon, unmonitored: [], parking_areas: [{ parking_area_id: "area", polygon }] };
const area: ParkingAreaLiveState = { parking_area_id: "area", status: "LIVE", regions: [{ kind: "ALMOST_AVAILABLE", polygon }, { kind: "AVAILABLE", polygon }] };

test("the parking overview shares the main map frame and the entrance overview includes the approach", () => {
  const map = buildLotMap({
    ...lot,
    landmarks: [{ landmark_id: "entrance-1", kind: "ENTRANCE", position: { x_m: 1, y_m: -6 }, measurement_source: "MEASURED" }],
  }, [area]);
  assert.deepEqual(guardBoothFrame(map, "parking"), { minX: 0, minY: 0, maxX: 2, maxY: 2 });
  assert.deepEqual(guardBoothFrame(map, "entrance"), { minX: 0, minY: -6, maxX: 2, maxY: 2 });
});

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
  const motorcycles = [{ detection_id: "m1", center: { x_m: 1, y_m: 1 }, heading_rad: 0, length_m: 2, width_m: 0.66, confidence: 0.9, display_scale: 1 }];
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

test("Sripatum routes approach both aisles from the right without crossing a parking row", () => {
  const entrance = { x_m: 21.5, y_m: -21 };
  const sripatum: LotModel = { ...lot, landmarks: [{ landmark_id: "entrance-1", kind: "ENTRANCE", position: entrance, measurement_source: "ESTIMATED" }] };
  const map = buildLotMap(sripatum, [{ ...area, source: "SYNTHETIC_FIXTURE" }]);
  for (const [destination, aisleY] of [[{ x_m: 11, y_m: 5 }, 3.2], [{ x_m: 11, y_m: 12 }, 10.2]] as const) {
    const route = sripatumPreviewRoute(map, "sripatum", destination)!;
    assert.deepEqual(route[0], entrance);
    assert.deepEqual(route.slice(-3), [{ x_m: 28.9, y_m: aisleY }, { x_m: 11, y_m: aisleY }, destination]);
  }
  assert.equal(sripatumPreviewRoute(map, "sripatum", { x_m: 11, y_m: 14.5 }), undefined);
  assert.equal(sripatumPreviewRoute(map, "sripatum", { x_m: 30, y_m: 12 }), undefined);
});

test("recorded Segment width regions do not become a destination in the browser", () => {
  const widthRegion: MetricPolygon = [[{ x_m: 10, y_m: 4 }, { x_m: 12, y_m: 4 }, { x_m: 12, y_m: 6 }, { x_m: 10, y_m: 6 }]];
  const site: LotModel = { ...lot, landmarks: [{ landmark_id: "entrance-1", kind: "ENTRANCE", position: { x_m: 21.5, y_m: -21 }, measurement_source: "MEASURED" }] };
  const segment: ParkingAreaLiveState = { ...area, status: "DEMO", source: "STILL_IMAGE_LOOP", regions: [{ kind: "WIDTH_SUFFICIENT", polygon: widthRegion }] };
  const map = buildLotMap(site, [segment]);
  assert.equal(guardBoothPreviewDestination(map, "preview", "sripatum"), null);
  assert.equal(guardBoothPreviewDestination(map, "unknown", "sripatum"), null);
  assert.equal(guardBoothPreviewDestination(map, "fit-preview", "sripatum"), null);
  assert.equal(sripatumPreviewRoute(map, "sripatum", { x_m: 11, y_m: 5 }), undefined);
});

test("a known classification on a current recorded frame uses the fitting API's example family", () => {
  assert.equal(guardBoothFitFamily("preview", "forza", true), "grand_filano");
  assert.equal(guardBoothFitFamily("fit-preview", "forza", true), "forza");
  assert.equal(guardBoothFitFamily("unknown", "forza", true), null);
  assert.equal(guardBoothFitFamily("preview", null, false), null);
});

const rider = (family: string | null, sized = true, arrival_s = 1): GuardBoothRider => ({
  arrival_s, reason: family ? "CLASSIFIED" : "UNCERTAIN", family, top3: [{ family: family ?? "wave", score: family ? 0.9 : 0.4 }],
  preview_url: "data:image/jpeg;base64,/9j/AA==", reference_size: family && sized ? { width_m: 0.7, length_m: 1.9 } : null,
});

test("only a classified family with a reference size gets a fitted frame", () => {
  assert.deepEqual(entranceClipOutcome(rider("click")), { mode: "fit-preview", family: "click", fitFamily: "click" });
  assert.deepEqual(entranceClipOutcome(rider("hd_road_glide", false)), { mode: "unknown", family: "hd_road_glide", fitFamily: null });
  assert.deepEqual(entranceClipOutcome(rider(null)), { mode: "unknown", family: null, fitFamily: null });
  assert.deepEqual(entranceClipOutcome(null), { mode: "unknown", family: null, fitFamily: null });
});

test("the booth follows the latest rider to reach the zone", () => {
  const riders = [rider("click", true, 1), rider("forza", true, 2.5)];
  assert.equal(arrivedRider(riders, 0.9), -1);
  assert.equal(arrivedRider(riders, 1), 0);
  assert.equal(arrivedRider(riders, 2.4), 0);
  assert.equal(arrivedRider(riders, 17), 1);
  assert.equal(arrivedRider([], 17), -1);
});

function arrival(seq: number, arrivedAt: number) {
  return { seq, rider: rider("click"), arrivedAt, requestId: `request-${seq}` };
}

test("riders queue newest first, each in its own colour slot", () => {
  let queue = enqueueRider([], arrival(1, 0), 0);
  queue = enqueueRider(queue, arrival(2, 2_000), 2_000);
  assert.deepEqual(queue.map(({ seq, slot, alone }) => [seq, slot, alone]), [[2, 1, false], [1, 0, true]]);
  assert.equal(RIDER_COLORS.length, RIDER_QUEUE_LIMIT);
});

test("a fourth rider drops the oldest and takes its colour", () => {
  let queue: ReturnType<typeof enqueueRider> = [];
  for (const seq of [1, 2, 3, 4]) queue = enqueueRider(queue, arrival(seq, seq * 1_000), seq * 1_000);
  assert.deepEqual(queue.map(({ seq, slot }) => [seq, slot]), [[4, 0], [3, 2], [2, 1]]);
});

test("a rider expires by time, not when another arrives", () => {
  const queue = enqueueRider(enqueueRider([], arrival(1, 0), 0), arrival(2, 10_000), 10_000);
  assert.equal(activeRiders(queue, RIDER_QUEUE_MS - 1), queue);
  assert.deepEqual(activeRiders(queue, RIDER_QUEUE_MS).map(({ seq }) => seq), [2]);
  assert.deepEqual(activeRiders(queue, 10_000 + RIDER_QUEUE_MS), []);
  const next = enqueueRider(queue, arrival(3, RIDER_QUEUE_MS), RIDER_QUEUE_MS);
  assert.deepEqual(next.map(({ seq, slot }) => [seq, slot]), [[3, 0], [2, 1]]);
});

test("a rider is sent to its pin once its frame is placed", () => {
  assert.deepEqual(riderGuide(rider("click"), "placed", 2), { tone: "go", text: "ไปที่หมุด 2" });
  assert.deepEqual(riderGuide(rider("click"), "pending", 1), { tone: "wait", text: "กำลังหาที่จอด" });
  assert.deepEqual(riderGuide(rider("forza"), "no-space", 1), { tone: "stop", text: "ไม่มีที่ว่างพอสำหรับรุ่นนี้" });
  assert.equal(riderGuide(rider("click"), "no-frame", 1).tone, "stop");
});

test("a rider without a placement of its own is sent to the free space", () => {
  for (const unplaced of [rider("cbr650r", false), rider(null), null]) {
    assert.deepEqual(riderGuide(unplaced, "placed", 1, undefined, "free"), { tone: "free", text: "จอดในพื้นที่สีเขียว" });
    assert.deepEqual(riderGuide(unplaced, "no-frame", 1), { tone: "stop", text: "ยังยืนยันพื้นที่ว่างไม่ได้" });
    assert.deepEqual(riderGuide(unplaced, "pending", 1, undefined, "none"), { tone: "stop", text: "ยังไม่พบพื้นที่ว่างที่ยืนยันได้" });
  }
});

test("a rider is named by its model, or as unknown", () => {
  assert.equal(riderTitle(rider("click")), "Honda Click");
  assert.equal(riderTitle(rider("cbr650r", false)), "Honda CBR650R");
  assert.equal(riderTitle(rider(null)), "ไม่ทราบรุ่นรถ");
  assert.equal(riderTitle(null), "ตรวจรุ่นรถไม่ได้");
  assert.equal(guardBoothModelName("new_family"), "new_family");
});

test("only an inline JPEG crop is shown", () => {
  assert.equal(entranceClipCrop(rider("click")), "data:image/jpeg;base64,/9j/AA==");
  for (const preview_url of ["https://example.com/crop.jpg", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,\"><script>", null]) {
    assert.equal(entranceClipCrop({ ...rider("click"), preview_url }), null);
  }
});

test("only a rider that arrived alone and is still alone gets the route", () => {
  assert.equal(routeRiderSeq([]), undefined);
  const first = enqueueRider([], arrival(1, 0), 0);
  assert.equal(routeRiderSeq(first), 1);
  // A rider close behind leaves both with their pins only.
  const both = enqueueRider(first, arrival(2, 5_000), 5_000);
  assert.equal(routeRiderSeq(both), undefined);
  // The later rider does not get the route when the earlier one expires.
  assert.equal(routeRiderSeq(activeRiders(both, RIDER_QUEUE_MS)), undefined);
  // A rider arriving after the queue emptied gets it again.
  assert.equal(routeRiderSeq(enqueueRider(both, arrival(3, 5_000 + RIDER_QUEUE_MS), 5_000 + RIDER_QUEUE_MS)), 3);
});

test("the clip's riders are asked for again only while the API is still classifying it", () => {
  assert.equal(classificationRetryMs(503, "5"), 5_000);
  assert.equal(classificationRetryMs(503, "3600"), CLASSIFICATION_RETRY_MAX_MS);
  for (const [status, retryAfter] of [[503, null], [503, "0"], [503, "soon"], [503, "1.5"], [502, "5"], [404, "5"]] as const) {
    assert.equal(classificationRetryMs(status, retryAfter), undefined, `${status} ${retryAfter}`);
  }
});
