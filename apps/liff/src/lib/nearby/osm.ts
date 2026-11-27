import { type LatLng, distanceM } from "./distance.ts";
import type { OsmPlace } from "./places.ts";

// OpenStreetMap's motorcycle parking around the campus, from an Overpass API response. The response
// is outside data that anyone can edit, so every element is checked and anything malformed or
// outside the circle is dropped, never trusted.

const NAME_MAX = 80;
const TAG_MAX = 120;

/** Overpass QL for motorcycle parking, and car parks that take motorcycles, within `metres` of `center`. */
export function overpassQuery({ latitude, longitude }: LatLng, metres: number): string {
  const around = `(around:${metres},${latitude},${longitude})`;
  return `[out:json][timeout:60];(nwr["amenity"="motorcycle_parking"]${around};nwr["amenity"="parking"]["motorcycle"~"^(yes|designated)$"]${around};);out center tags;`;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function place(element: unknown, center: LatLng, metres: number): OsmPlace | null {
  if (typeof element !== "object" || element === null) return null;
  const { type, id, lat, lon, center: middle, tags } = element as Record<string, unknown>;
  if ((type !== "node" && type !== "way" && type !== "relation") || !Number.isSafeInteger(id) || (id as number) <= 0) return null;
  // Nodes carry their position; ways and relations carry the centre `out center` adds.
  const at = type === "node" ? { lat, lon } : typeof middle === "object" && middle !== null ? (middle as Record<string, unknown>) : {};
  const latitude = coordinate(at.lat);
  const longitude = coordinate(at.lon);
  if (latitude === null || longitude === null || distanceM(center, { latitude, longitude }) > metres) return null;
  const tag = (key: string) => (typeof tags === "object" && tags !== null ? text((tags as Record<string, unknown>)[key], TAG_MAX) : null);
  const named = text(tag("name:th"), NAME_MAX) ?? text(tag("name"), NAME_MAX);
  const operator = text(tag("operator"), NAME_MAX);
  const fee = tag("charge") ?? (tag("fee") === "no" ? "ฟรี" : tag("fee") === "yes" ? "เสียค่าจอด" : null);
  const hours = tag("opening_hours");
  const covered = tag("covered") === "yes" ? true : tag("covered") === "no" ? false : null;
  return {
    id: `osm-${type}-${id}`,
    osm: `${type}/${id}`,
    name: named ?? (operator ? `ที่จอดมอเตอร์ไซค์ ${operator}` : "ที่จอดมอเตอร์ไซค์"),
    latitude,
    longitude,
    kind: "OSM",
    fee,
    hours: hours === "24/7" ? "ตลอด 24 ชม." : hours,
    covered,
    photos: [],
  };
}

/** The valid places within `metres` of `center`, once each, in a stable order; throws on a malformed response. */
export function osmPlaces(response: unknown, center: LatLng, metres: number): OsmPlace[] {
  const elements = typeof response === "object" && response !== null ? (response as Record<string, unknown>).elements : undefined;
  if (!Array.isArray(elements)) throw new Error("Overpass response has no elements list");
  const byId = new Map<string, OsmPlace>();
  for (const element of elements) {
    const found = place(element, center, metres);
    if (found) byId.set(found.id, found);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
