import assert from "node:assert/strict";
import { test } from "node:test";
import { guideStatus } from "./guide.ts";

const ready = { enabled: true, loading: false, recordedFrame: true, family: "click", preferenceError: false, failed: false, requested: true, answer: null, held: false, expired: false };

test("the guide claims nothing without the recommendation endpoint or a current recorded photo", () => {
  assert.equal(guideStatus({ ...ready, enabled: false }), "unavailable");
  assert.equal(guideStatus({ ...ready, recordedFrame: false, held: true }), "unavailable");
});

test("the guide waits for the parking state before saying it has no photo", () => {
  assert.equal(guideStatus({ ...ready, loading: true, recordedFrame: false }), "searching");
  assert.equal(guideStatus({ ...ready, enabled: false, loading: true }), "unavailable");
});

test("the model comes from the server, and one without a reference size is told so", () => {
  assert.equal(guideStatus({ ...ready, family: undefined }), "searching");
  assert.equal(guideStatus({ ...ready, preferenceError: true }), "unverified-model");
  assert.equal(guideStatus({ ...ready, family: null }), "unsupported-model");
  assert.equal(guideStatus({ ...ready, family: "other" }), "unsupported-model");
  assert.equal(guideStatus({ ...ready, family: "toString" }), "unsupported-model");
});

test("a request moves from searching to its answer", () => {
  assert.equal(guideStatus({ ...ready, requested: false }), "searching");
  assert.equal(guideStatus(ready), "searching");
  assert.equal(guideStatus({ ...ready, failed: true }), "failed");
  assert.equal(guideStatus({ ...ready, answer: { stage: "HELD", polygon: [] }, held: true }), "found");
  assert.equal(guideStatus({ ...ready, answer: { stage: null, polygon: null } }), "no-fit");
});

test("a place shown on another photo or before the ledger agrees is not claimed", () => {
  assert.equal(guideStatus({ ...ready, answer: { stage: "HELD", polygon: [] } }), "searching");
});

test("a hold ends by confirmation, by a parked rider, or by release", () => {
  assert.equal(guideStatus({ ...ready, answer: { stage: "HELD", polygon: [] }, expired: true }), "confirming");
  assert.equal(guideStatus({ ...ready, answer: { stage: "AWAITING_CONFIRMATION", polygon: [] } }), "confirming");
  assert.equal(guideStatus({ ...ready, answer: { stage: "OCCUPIED_CONFIRMED", polygon: [] } }), "parked");
  assert.equal(guideStatus({ ...ready, answer: { stage: "RELEASED", polygon: [] } }), "released");
});
