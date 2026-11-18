// Distances between places and the campus, and directions that leave the start to Google Maps.

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6_371_008.8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Google Maps directions to the place from wherever the rider is; Maps finds the start itself. */
export function directionsUrl({ latitude, longitude }: LatLng): string {
  const params = new URLSearchParams({ api: "1", destination: `${latitude},${longitude}` });
  return `https://www.google.com/maps/dir/?${params}`;
}
