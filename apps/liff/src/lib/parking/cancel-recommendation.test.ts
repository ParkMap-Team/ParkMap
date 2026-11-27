import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { cancelRecommendation, waitForRecommendationRequests } from "./cancel-recommendation.ts";

test("cancel sends DELETE and does not silently succeed on failure", async () => {
  await cancelRecommendation(async (url, options) => {
    assert.equal(url, "/api/sites/sripatum/parking-recommendation");
    assert.equal(options?.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  await assert.rejects(cancelRecommendation(async () => new Response(null, { status: 502 })), /ยกเลิก/);
});

test("cancellation waits for an in-flight allocation before releasing it", async () => {
  const client = new QueryClient();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const mutation = client.getMutationCache().build(client, {
    mutationKey: ["line-parking-recommendation-request"], mutationFn: () => blocked,
  });
  const allocation = mutation.execute(undefined);
  let finished = false;
  const waiting = waitForRecommendationRequests(client).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await allocation;
  await waiting;
  assert.equal(finished, true);
  client.clear();
});
