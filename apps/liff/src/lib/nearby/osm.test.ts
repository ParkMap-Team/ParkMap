import assert from "node:assert/strict";
import { test } from "node:test";
import { overpassQuery, osmPlaces } from "./osm.ts";

const CENTER = { latitude: 13.85528, longitude: 100.58528 };

test("the query asks for motorcycle parking and car parks that take motorcycles around the centre", () => {
  const query = overpassQuery(CENTER, 2_000);
  assert.match(query, /\[out:json\]/);
  assert.match(query, /nwr\["amenity"="motorcycle_parking"\]\(around:2000,13\.85528,100\.58528\)/);
  assert.match(query, /\["motorcycle"~"\^\(yes\|designated\)\$"\]/);
  assert.match(query, /out center tags;$/);
});

test("nodes use their position, ways their centre, and tags become the place's facts", () => {
  const places = osmPlaces({
    elements: [
      { type: "way", id: 589579457, center: { lat: 13.8522764, lon: 100.5821179 }, tags: { amenity: "motorcycle_parking", fee: "yes", operator: "Park Place" } },
      { type: "node", id: 11209447337, lat: 13.8455431, lon: 100.5714485, tags: { name: "จุดจอดรถ", "name:th": "จุดจอดรถมอเตอร์ไซค์", opening_hours: "24/7", covered: "yes" } },
      { type: "node", id: 7, lat: 13.855, lon: 100.585, tags: { fee: "no", charge: "10 THB/day", covered: "no", opening_hours: "Mo-Fr 06:00-22:00" } },
    ],
  }, CENTER, 2_000);
  assert.deepEqual(places, [
    { id: "osm-node-11209447337", osm: "node/11209447337", name: "จุดจอดรถมอเตอร์ไซค์", latitude: 13.8455431, longitude: 100.5714485, kind: "OSM", fee: null, hours: "ตลอด 24 ชม.", covered: true, photo: null },
    { id: "osm-node-7", osm: "node/7", name: "ที่จอดมอเตอร์ไซค์", latitude: 13.855, longitude: 100.585, kind: "OSM", fee: "10 THB/day", hours: "Mo-Fr 06:00-22:00", covered: false, photo: null },
    { id: "osm-way-589579457", osm: "way/589579457", name: "ที่จอดมอเตอร์ไซค์ Park Place", latitude: 13.8522764, longitude: 100.5821179, kind: "OSM", fee: "เสียค่าจอด", hours: null, covered: null, photo: null },
  ]);
});

test("malformed, duplicate, and out-of-range elements are dropped", () => {
  const ok = { type: "node", id: 1, lat: 13.855, lon: 100.585, tags: {} };
  const places = osmPlaces({
    elements: [
      ok,
      ok,
      null,
      "node",
      { type: "area", id: 2, lat: 13.855, lon: 100.585 },
      { type: "node", id: -3, lat: 13.855, lon: 100.585 },
      { type: "node", id: 4.5, lat: 13.855, lon: 100.585 },
      { type: "node", id: 5, lat: "13.855", lon: 100.585 },
      { type: "node", id: 6, lat: Number.NaN, lon: 100.585 },
      { type: "way", id: 7, lat: 13.855, lon: 100.585 },
      { type: "node", id: 8, lat: 13.9, lon: 100.585 },
      { type: "node", id: 9, lat: 13.855, lon: 100.585, tags: { name: "x".repeat(81) } },
    ],
  }, CENTER, 2_000);
  assert.deepEqual(places.map((place) => [place.id, place.name]), [["osm-node-1", "ที่จอดมอเตอร์ไซค์"], ["osm-node-9", "ที่จอดมอเตอร์ไซค์"]]);
});

test("a response without an elements list is an error, not an empty map", () => {
  assert.throws(() => osmPlaces({ remark: "runtime error" }, CENTER, 2_000), /no elements/);
  assert.throws(() => osmPlaces(null, CENTER, 2_000), /no elements/);
});
