import type { GuardBoothFit, MetricPoint, MetricPolygon } from "../api/types.ts";
import { boundsOf, labelPoint, pointInPolygon } from "../map/geometry.ts";
import type { LotMap } from "../map/lot-map.ts";

export type GuardBoothMode = "waiting" | "classifying" | "preview" | "fit-preview" | "unknown" | "no-fit" | "unavailable";
export type GuardBoothOverview = "entrance" | "parking";

export function guardBoothFitFamily(mode: GuardBoothMode | undefined, selected: GuardBoothFit["family"] | null, hasRecordedFrame: boolean): GuardBoothFit["family"] | null {
  if (!hasRecordedFrame) return null;
  if (mode === "preview") return "grand_filano";
  return mode === "fit-preview" ? selected : null;
}

export function guardBoothFrame(map: LotMap, overview: GuardBoothOverview) {
  return overview === "entrance" ? map.bounds : map.frame;
}

export const PARKING_HOLD_MS = 120_000;
export type ParkingHold = { areaId: string; polygon: MetricPolygon; expiresAt: number };

// Conservative suppression for the local preview. Touching edges are allowed.
export function overlapsParkingHold(polygon: MetricPolygon, held: MetricPolygon): boolean {
  const a = boundsOf(polygon[0]);
  const b = boundsOf(held[0]);
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function activeParkingHolds(map: LotMap, holds: readonly ParkingHold[], now: number): readonly ParkingHold[] {
  const active = holds.filter((hold) => {
    if (hold.expiresAt <= now) return false;
    const area = map.areas.find(({ parkingAreaId }) => parkingAreaId === hold.areaId);
    if (!area || area.unknownReason || area.regions.some(({ kind, polygon }) => kind === "UNKNOWN" && overlapsParkingHold(polygon, hold.polygon))) return true;
    // Let the API occupancy take over once it shows a motorcycle there and
    // has stopped offering every placement that overlaps the held area.
    const occupied = area.motorcycles.some(({ proxy }) => pointInPolygon(proxy.center, hold.polygon));
    return !occupied || area.regions.some(({ kind, polygon }) => kind !== "UNKNOWN" && overlapsParkingHold(polygon, hold.polygon));
  });
  return active.length === holds.length ? holds : active;
}

export function applyParkingHolds(map: LotMap, holds: readonly ParkingHold[]): LotMap {
  if (!holds.length) return map;
  return { ...map, areas: map.areas.map((area) => ({
    ...area,
    regions: area.regions.filter(({ kind, polygon }) => kind === "UNKNOWN" || !holds.some(
      (hold) => hold.areaId === area.parkingAreaId && overlapsParkingHold(polygon, hold.polygon),
    )),
  })) };
}

export function guardBoothHeadline(mode: GuardBoothMode, hasCurrentAreas: boolean, hasDestination: boolean, hasRoute: boolean): string {
  if (!hasCurrentAreas || mode === "unavailable") return "ยังยืนยันพื้นที่ว่างไม่ได้";
  switch (mode) {
    case "waiting": return "รอรถคันถัดไป";
    case "classifying": return "กำลังตรวจรุ่นรถ";
    case "unknown": return hasDestination ? "ดูพื้นที่ว่างสีเขียว" : "ไม่พบพื้นที่ว่างที่ยืนยันได้";
    case "no-fit": return "ไม่พบจุดจอดที่พอดีกับรถคันนี้";
    case "fit-preview": return hasDestination ? "พบพื้นที่ที่วางกรอบรถได้" : "ไม่พบพื้นที่ที่วางกรอบขนาดนี้ได้";
    case "preview":
      if (!hasDestination) return "ยังไม่มีจุดจอดที่ยืนยันได้";
      return hasRoute ? "ไปตามเส้นสีน้ำเงิน" : "จอดตรงจุดที่ลูกศรชี้";
  }
}

const RIGHT_ACCESS_X = 28.9;

/** Centre lines and served rows in lot coordinates from the Sripatum reference and Setup map. */
function sripatumAisleY({ x_m, y_m }: MetricPoint): number | undefined {
  if (x_m >= RIGHT_ACCESS_X || y_m < 0 || y_m >= 13.8) return;
  return y_m < 6.7 ? 3.2 : 10.2;
}

/** Waypoints for the Sripatum synthetic scene through the opening beside the planters. */
export function sripatumPreviewRoute(map: LotMap, siteId: string, destination: MetricPoint | undefined): MetricPoint[] | undefined {
  if (siteId !== "sripatum" || !destination || !map.areas.some(({ live }) => live?.source === "SYNTHETIC_FIXTURE")) return;
  const entrance = map.landmarks.find(({ landmark_id, kind }) => landmark_id === "entrance-1" && kind === "ENTRANCE");
  const aisleY = sripatumAisleY(destination);
  if (!entrance || aisleY === undefined) return;
  return [
    entrance.position,
    { x_m: entrance.position.x_m, y_m: -8 },
    { x_m: RIGHT_ACCESS_X, y_m: -8 },
    { x_m: RIGHT_ACCESS_X, y_m: aisleY },
    { x_m: destination.x_m, y_m: aisleY },
    destination,
  ];
}

/** The preview points to an existing engine placement for its standard footprint. */
export function guardBoothPreviewDestination(map: LotMap, mode: GuardBoothMode, siteId?: string) {
  if (mode !== "preview") return null;
  for (const area of map.areas) {
    const unknown = area.regions.filter(({ kind }) => kind === "UNKNOWN");
    const placement = area.regions.find(({ kind, polygon }) =>
      kind === "AVAILABLE" && !unknown.some((region) => overlapsParkingHold(polygon, region.polygon)) &&
      (siteId !== "sripatum" || area.live?.source !== "SYNTHETIC_FIXTURE" || sripatumAisleY(labelPoint(polygon)) !== undefined),
    );
    if (placement) {
      return { areaId: area.parkingAreaId, point: labelPoint(placement.polygon), polygon: placement.polygon, text: "จอดตรงนี้", destination: true };
    }
  }
  return null;
}
