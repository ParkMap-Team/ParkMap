import assert from "node:assert/strict";
import { test } from "node:test";
import { homeSiteId } from "./home.ts";

const sites = [{ site_id: "dev-site" }, { site_id: "sripatum" }];

test("home opens Sripatum when nothing is configured", () => {
  assert.equal(homeSiteId(sites), "sripatum");
});

test("home opens the configured site when it exists", () => {
  assert.equal(homeSiteId(sites, "dev-site"), "dev-site");
});

test("home opens the only site when the configured one is missing", () => {
  assert.equal(homeSiteId([{ site_id: "dev-site" }]), "dev-site");
});

test("home opens no site when the choice is not clear", () => {
  assert.equal(homeSiteId([{ site_id: "dev-site" }, { site_id: "other" }]), null);
  assert.equal(homeSiteId(sites, "gone"), null);
  assert.equal(homeSiteId([]), null);
});
