import assert from "node:assert/strict";
import { test } from "node:test";
import { requireBotReady } from "./bot-ready.ts";

test("publishing settings requires a public HTTPS bot health URL without credentials", async () => {
  const noRequest = async () => { throw new Error("No request should be made"); };
  for (const url of [undefined, "", "invalid", "http://example.com/api/health",
    "https://user:password@example.com/api/health", "https://example.com/api/health?token=private"])
    await assert.rejects(requireBotReady(url, noRequest), /LINE_BOT_HEALTH_URL/);
});

test("an unavailable or different service cannot authorize publishing the menu", async () => {
  for (const response of [Response.json({}, { status: 503 }), Response.json({ status: "ok" })])
    await assert.rejects(requireBotReady("https://bot.example.com/api/health", async () => response), /not ready/);
});

test("a ready bot is checked without sending the LINE access token", async () => {
  await requireBotReady("https://bot.example.com/api/health", async (input, init) => {
    assert.equal(String(input), "https://bot.example.com/api/health");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return Response.json({ status: "ok", service: "parkmap-line-bot" });
  });
});
