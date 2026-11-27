import type { SiteSummary } from "../api/types.ts";
import { type LatLng, distanceM } from "./distance.ts";
import { OSM_PLACES } from "./osm-places.gen.ts";

// The places the nearby map pins, all within RADIUS_M of the campus: lots with cameras come from the
// API, the team's list of motorcycle parking it checked lives here next to its photos in
// `public/nearby/`, and OpenStreetMap fills in what the team has not listed. Only the lots with
// cameras know whether they have room; the page never shows or implies it for the others.

/** Sripatum University, Bang Khen: every pin is within RADIUS_M of it. */
export const CAMPUS: LatLng = { latitude: 13.85528, longitude: 100.58528 };
export const RADIUS_M = 2_000;
/** The campus grounds as [[west, south], [east, north]], from OpenStreetMap way/1562195823; the map opens on them. */
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [[100.5838235, 13.8534299], [100.586311, 13.8564743]];

type PlaceBase = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** As the place charges it, such as "ฟรี" or "10 บาท/วัน"; null when nobody has checked. */
  fee: string | null;
  /** Such as "ทุกวัน 06:00-22:00"; null when nobody has checked. */
  hours: string | null;
  /** Whether motorcycles park under a roof; null when nobody has checked. */
  covered: boolean | null;
  /** WebP files in `public/nearby/`, with faces and readable licence plates blurred. */
  photos: readonly string[];
};

/** A place the team listed, in the campus or near it. */
export type ListedPlace = PlaceBase & {
  kind: "CAMPUS" | "NEARBY";
  /** The OpenStreetMap element this entry replaces, such as "way/589579457"; null when none. */
  osm: string | null;
};

/** Motorcycle parking mapped in OpenStreetMap; `scripts/nearby-osm.ts` refreshes the list. */
export type OsmPlace = PlaceBase & { kind: "OSM"; osm: string };

/** A pin: a listed place, an OpenStreetMap place, or a lot with cameras whose live map is one tap away. */
export type NearbyPlace = ListedPlace | OsmPlace | (PlaceBase & { kind: "CAMERA"; siteId: string });

/**
 * Motorcycle parking the team checked on foot, within RADIUS_M of CAMPUS. To add a place, copy the
 * template below, take the coordinates from the pin in Google Maps, and put its photo in
 * `public/nearby/` (WebP, about 1200 px wide, faces and plates blurred). If the map already shows
 * the place from OpenStreetMap, set `osm` to that element so it is not pinned twice.
 * `places.test.ts` checks every entry.
 *
 * ```ts
 * {
 *   id: "example-place",          // lowercase words joined by "-", unique
 *   name: "ชื่อที่จอดที่ป้ายหรือคนแถวนั้นเรียก",
 *   latitude: 0,                  // from the Google Maps pin, 5+ decimals
 *   longitude: 0,
 *   kind: "CAMPUS",               // or "NEARBY" outside the campus
 *   fee: "ฟรี",                   // or null if unchecked
 *   hours: "ทุกวัน 06:00-22:00",  // or null if unchecked
 *   covered: true,                // or null if unchecked
 *   photos: ["example-place.webp"], // or []
 *   osm: null,                    // or "node/123", "way/123" from osm-places.gen.ts
 * },
 * ```
 */
export const LISTED_PLACES: readonly ListedPlace[] = [
  {
    id: "campus-motorcycle-parking",
    name: "ลานจอดรถในมหาวิทยาลัย",
    latitude: 13.854267,
    longitude: 100.584388,
    kind: "CAMPUS",
    fee: "ฟรี",
    hours: "ตามเวลาเปิด-ปิดมหาวิทยาลัย",
    covered: true,
    photos: ["campus-motorcycle-parking-6154.webp", "campus-motorcycle-parking-6156.webp"],
    osm: null,
  },
];

/** Every pin within RADIUS_M of CAMPUS: the lots with cameras, then the listed places, then OpenStreetMap's. */
export function nearbyPlaces(
  sites: readonly SiteSummary[],
  listed: readonly ListedPlace[] = LISTED_PLACES,
  osm: readonly OsmPlace[] = OSM_PLACES,
): NearbyPlace[] {
  const replaced = new Set(listed.flatMap((place) => (place.osm === null ? [] : [place.osm])));
  const places: NearbyPlace[] = [
    ...sites.map((site) => ({
      id: `site-${site.site_id}`,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      kind: "CAMERA" as const,
      siteId: site.site_id,
      fee: null,
      hours: null,
      covered: null,
      photos: [],
    })),
    ...listed,
    ...osm.filter((place) => !replaced.has(place.osm)),
  ];
  return places.filter((place) => distanceM(CAMPUS, place) <= RADIUS_M);
}
