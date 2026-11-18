import assert from "node:assert/strict";
import { test } from "node:test";
import { lineOaId, reportChatUrl, shortCommit } from "./app-info.ts";

test("a build's commit shows as its first seven characters", () => {
  assert.equal(shortCommit("8C11B65d4e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b"), "8c11b65");
  assert.equal(shortCommit(" 8c11b65 "), "8c11b65");
});

test("a build without a commit, or with something else in its place, shows no version", () => {
  assert.equal(shortCommit(undefined), null);
  assert.equal(shortCommit(""), null);
  assert.equal(shortCommit("main"), null);
  assert.equal(shortCommit("8c11b6"), null);
});

test("the official account's ID needs its @ and only the characters LINE allows", () => {
  assert.equal(lineOaId(" @123ABCDE "), "@123abcde");
  assert.equal(lineOaId("@park.map_th-1"), "@park.map_th-1");
  assert.equal(lineOaId("123abcde"), null);
  assert.equal(lineOaId("@"), null);
  assert.equal(lineOaId("@park map"), null);
  assert.equal(lineOaId(undefined), null);
});

test("the report link opens the account's chat with the version in the message", () => {
  assert.equal(
    reportChatUrl("@123abcde", "8c11b65"),
    `https://line.me/R/oaMessage/%40123abcde/?${encodeURIComponent("แจ้งปัญหา ParkMap (เวอร์ชัน 8c11b65)\n")}`,
  );
  assert.equal(reportChatUrl("@123abcde", null), `https://line.me/R/oaMessage/%40123abcde/?${encodeURIComponent("แจ้งปัญหา ParkMap\n")}`);
});
