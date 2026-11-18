// Distances on the rider's own device: the position never leaves the page (CONTEXT "Nearby parking
// map"). They are straight lines, so the text says so; the road distance is Google Maps' to show.

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

/** "ห่าง 350 ม." to the nearest 10 m under a kilometre, then "ห่าง 1.2 กม." to the nearest 100 m. */
export function distanceText(metres: number): string {
  if (metres < 995) return `ห่าง ${Math.max(10, Math.round(metres / 10) * 10)} ม.`;
  return `ห่าง ${Math.round(metres / 100) / 10} กม.`;
}

/** Google Maps directions to the place from wherever the rider is; Maps finds the start itself. */
export function directionsUrl({ latitude, longitude }: LatLng): string {
  const params = new URLSearchParams({ api: "1", destination: `${latitude},${longitude}` });
  return `https://www.google.com/maps/dir/?${params}`;
}
