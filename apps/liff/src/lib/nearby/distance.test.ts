import assert from "node:assert/strict";
import { test } from "node:test";
import { directionsUrl, distanceM } from "./distance.ts";

test("a degree of latitude is about 111.2 km and a place is no distance from itself", () => {
  const a = { latitude: 13.87, longitude: 100.58 };
  assert.equal(distanceM(a, a), 0);
  assert.ok(Math.abs(distanceM({ latitude: 0, longitude: 100 }, { latitude: 1, longitude: 100 }) - 111_195) < 1);
});

test("a degree of longitude shrinks with the cosine of the latitude", () => {
  const along = distanceM({ latitude: 60, longitude: 10 }, { latitude: 60, longitude: 11 });
  assert.ok(Math.abs(along - 111_195 * Math.cos(Math.PI / 3)) < 100);
});

test("distance is the same in both directions", () => {
  const a = { latitude: 13.8761, longitude: 100.5853 };
  const b = { latitude: 13.8702, longitude: 100.5911 };
  assert.equal(distanceM(a, b), distanceM(b, a));
});

test("directions name only the destination, with its comma encoded", () => {
  assert.equal(
    directionsUrl({ latitude: 13.8761, longitude: 100.5853 }),
    "https://www.google.com/maps/dir/?api=1&destination=13.8761%2C100.5853",
  );
});
