import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTab, isMapPath } from "./tabs.ts";

test("the home map and a site's map are map screens", () => {
  assert.equal(isMapPath("/"), true);
  assert.equal(isMapPath("/sites/sripatum"), true);
  assert.equal(isMapPath("/sites/sripatum/guard-booth"), false);
  assert.equal(isMapPath("/settings"), false);
});

test("each tab owns its path and other screens have none", () => {
  assert.equal(activeTab("/"), "map");
  assert.equal(activeTab("/sites/sripatum"), "map");
  assert.equal(activeTab("/parked"), "parked");
  assert.equal(activeTab("/nearby"), "nearby");
  assert.equal(activeTab("/settings"), "settings");
  // Help opens from settings and the rich menu, not from a tab.
  assert.equal(activeTab("/help"), null);
  assert.equal(activeTab("/settingsx"), null);
});
