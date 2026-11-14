import assert from "node:assert/strict";
import { test } from "node:test";
import { homeSiteId } from "./home.ts";

const sites = [{ site_id: "dev-site" }, { site_id: "sripatum" }];

test("home opens the configured site when it exists", () => {
  assert.equal(homeSiteId(sites, "sripatum"), "sripatum");
});

test("home opens the only site when none is configured", () => {
  assert.equal(homeSiteId([{ site_id: "sripatum" }], undefined), "sripatum");
});

test("home lists the sites when the choice is not clear", () => {
  assert.equal(homeSiteId(sites, undefined), null);
  assert.equal(homeSiteId(sites, "gone"), null);
  assert.equal(homeSiteId([], "sripatum"), null);
});
