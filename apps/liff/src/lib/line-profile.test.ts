import assert from "node:assert/strict";
import { test } from "node:test";
import { lineProfile } from "./line-profile.ts";

test("a LINE profile shows its name, first letter, and CDN picture", () => {
  assert.deepEqual(lineProfile({ displayName: " Alex ", pictureUrl: "https://profile.line-scdn.net/abc" }), {
    name: "Alex",
    initial: "A",
    picture: "https://profile.line-scdn.net/abc",
  });
});

test("a Thai name keeps its first consonant whole", () => {
  assert.equal(lineProfile({ displayName: "สมชาย" })?.initial, "ส");
  assert.equal(lineProfile({ displayName: "นุ่น" })?.initial, "นุ่");
});

test("a picture outside LINE's CDN, or not over HTTPS, is not drawn", () => {
  assert.equal(lineProfile({ displayName: "A" })?.picture, null);
  assert.equal(lineProfile({ displayName: "A", pictureUrl: "http://profile.line-scdn.net/abc" })?.picture, null);
  assert.equal(lineProfile({ displayName: "A", pictureUrl: "https://line-scdn.net.example.com/abc" })?.picture, null);
  assert.equal(lineProfile({ displayName: "A", pictureUrl: "not a url" })?.picture, null);
});

test("a profile with no name shows nothing", () => {
  assert.equal(lineProfile({ displayName: "   " }), null);
});
