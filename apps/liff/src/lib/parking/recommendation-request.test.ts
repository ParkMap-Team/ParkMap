import assert from "node:assert/strict";
import { test } from "node:test";
import { activeRecommendation, parkingRequestId, parkingSceneKey } from "./recommendation-request.ts";

test("refreshes reuse the same request, while another vehicle has its own request", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const id = parkingRequestId(storage, "sripatum:LINE:wave");
  assert.equal(parkingRequestId(storage, "sripatum:LINE:wave"), id);
  assert.notEqual(parkingRequestId(storage, "sripatum:LINE:forza"), id);
});

test("expiry, stale frames, and Segment-confirmed occupancy remove guidance", () => {
  const fit = { stage: "HELD", expires_at: "2026-11-18T00:02:00Z", observed_at: "photo-1", polygon: [] };
  const now = Date.parse("2026-11-18T00:01:00Z");
  assert.equal(activeRecommendation(fit, "photo-1", now), true);
  assert.equal(activeRecommendation(fit, "photo-2", now), false);
  assert.equal(activeRecommendation(fit, "photo-1", now + 60_000), false);
  assert.equal(activeRecommendation({ ...fit, stage: "OCCUPIED_CONFIRMED" }, "photo-1", now), false);
  assert.equal(activeRecommendation({ ...fit, stage: "AWAITING_CONFIRMATION" }, "photo-1", now), false);
});

test("revisiting a demo photo starts a new scene, while a refresh reuses the recent scene", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = parkingSceneKey(storage, "sripatum", "photo-1", 0);
  assert.equal(parkingSceneKey(storage, "sripatum", "photo-1", 10_000), first);
  parkingSceneKey(storage, "sripatum", "photo-2", 20_000);
  assert.notEqual(parkingSceneKey(storage, "sripatum", "photo-1", 30_000), first);
});
