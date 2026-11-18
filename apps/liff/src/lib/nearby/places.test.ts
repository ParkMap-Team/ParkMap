import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { distanceM } from "./distance.ts";
import { OSM_PLACES } from "./osm-places.gen.ts";
import { CAMPUS, CAMPUS_BOUNDS, LISTED_PLACES, type ListedPlace, type OsmPlace, RADIUS_M, nearbyPlaces } from "./places.ts";

const PHOTO_DIR = new URL("../../../public/nearby/", import.meta.url);

test("every listed place has a unique id, a location within the radius, and a photo that exists", () => {
  const ids = new Set<string>(OSM_PLACES.map((place) => place.id));
  for (const place of LISTED_PLACES) {
    assert.match(place.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, place.id);
    assert.ok(!ids.has(place.id), `duplicate id ${place.id}`);
    ids.add(place.id);
    assert.ok(place.name.trim(), `${place.id} has no name`);
    // Inside Thailand: catches a missing coordinate (0) and latitude and longitude swapped.
    assert.ok(place.latitude > 5 && place.latitude < 21, `${place.id} latitude ${place.latitude}`);
    assert.ok(place.longitude > 97 && place.longitude < 106, `${place.id} longitude ${place.longitude}`);
    assert.ok(distanceM(CAMPUS, place) <= RADIUS_M, `${place.id} is more than ${RADIUS_M} m from the campus`);
    if (place.osm !== null) assert.ok(OSM_PLACES.some((osm) => osm.osm === place.osm), `${place.id} replaces ${place.osm}, which osm-places.gen.ts lacks`);
    if (place.photo !== null) {
      assert.match(place.photo, /^[a-z0-9-]+\.webp$/, `${place.id} photo ${place.photo}`);
      assert.ok(existsSync(new URL(place.photo, PHOTO_DIR)), `${place.id} photo is missing from public/nearby/`);
    }
  }
});

test("the OpenStreetMap snapshot is within the radius, once each", () => {
  const ids = new Set<string>();
  for (const place of OSM_PLACES) {
    assert.ok(!ids.has(place.id), `duplicate id ${place.id}`);
    ids.add(place.id);
    assert.equal(place.id, `osm-${place.osm.replace("/", "-")}`);
    assert.ok(distanceM(CAMPUS, place) <= RADIUS_M, `${place.id} is more than ${RADIUS_M} m from the campus`);
  }
});

test("the campus point is inside the campus grounds the map opens on", () => {
  const [[west, south], [east, north]] = CAMPUS_BOUNDS;
  assert.ok(west < CAMPUS.longitude && CAMPUS.longitude < east && south < CAMPUS.latitude && CAMPUS.latitude < north);
});

const site = (id: string, latitude: number, longitude: number) => ({ site_id: id, name: id, latitude, longitude });
const listed: ListedPlace = {
  id: "listed", name: "ที่จอด", latitude: 13.856, longitude: 100.586, kind: "CAMPUS", fee: "ฟรี", hours: null, covered: true, photo: null, osm: "way/1",
};
const osm = (id: number): OsmPlace => ({
  id: `osm-way-${id}`, osm: `way/${id}`, name: "ที่จอดมอเตอร์ไซค์", latitude: 13.85, longitude: 100.58, kind: "OSM", fee: null, hours: null, covered: null, photo: null,
});

test("camera sites come first, link to their lot, and claim no fee, hours, or roof", () => {
  assert.deepEqual(nearbyPlaces([site("sripatum", 13.85528, 100.58528)], [], [])[0], {
    id: "site-sripatum", name: "sripatum", latitude: 13.85528, longitude: 100.58528, kind: "CAMERA", siteId: "sripatum", fee: null, hours: null, covered: null, photo: null,
  });
});

test("a listed place replaces the OpenStreetMap element it names, and the rest follow it", () => {
  assert.deepEqual(
    nearbyPlaces([site("sripatum", 13.85528, 100.58528)], [listed], [osm(1), osm(2)]).map((place) => place.id),
    ["site-sripatum", "listed", "osm-way-2"],
  );
});

test("only places within the radius of the campus are pinned", () => {
  // 13.8 N is about 6.1 km south of the campus; 13.873 N is about 1.97 km north of it.
  const places = nearbyPlaces([site("far", 13.8, 100.6), site("edge", 13.873, 100.58528)], [], []);
  assert.deepEqual(places.map((place) => place.id), ["site-edge"]);
});
