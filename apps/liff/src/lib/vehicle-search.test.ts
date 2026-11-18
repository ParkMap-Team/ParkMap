import assert from "node:assert/strict";
import { test } from "node:test";
import { modelMatches } from "./vehicle-search.ts";

test("a search finds a model by make or model, whatever the case", () => {
  assert.equal(modelMatches("Yamaha NMAX", "nmax"), true);
  assert.equal(modelMatches("Yamaha NMAX", "YAMAHA"), true);
  assert.equal(modelMatches("Honda Click", "click"), true);
});

test("spaces and hyphens in either side do not stop a match", () => {
  assert.equal(modelMatches("Honda CBR650R", "cbr 650"), true);
  assert.equal(modelMatches("Yamaha Grand Filano", "grandfilano"), true);
  assert.equal(modelMatches("Harley-Davidson Road Glide", "harley davidson"), true);
});

test("an empty search lists every model", () => {
  assert.equal(modelMatches("Honda Wave", ""), true);
  assert.equal(modelMatches("Honda Wave", "  "), true);
});

test("a search for a model that is not listed finds nothing", () => {
  assert.equal(modelMatches("Honda Wave", "vespa"), false);
  assert.equal(modelMatches("ไม่ระบุ", "vespa"), false);
});
