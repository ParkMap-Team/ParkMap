import type { MetricPoint } from "../api/types.ts";
import { labelPoint } from "../map/geometry.ts";
import type { LotMap } from "../map/lot-map.ts";

export type GuardBoothMode = "waiting" | "classifying" | "preview" | "unknown" | "no-fit" | "unavailable";

export function guardBoothHeadline(mode: GuardBoothMode, hasCurrentAreas: boolean, hasDestination: boolean, hasRoute: boolean): string {
  if (!hasCurrentAreas || mode === "unavailable") return "ยังยืนยันพื้นที่ว่างไม่ได้";
  switch (mode) {
    case "waiting": return "รอรถคันถัดไป";
    case "classifying": return "กำลังตรวจรุ่นรถ";
    case "unknown": return hasDestination ? "ดูพื้นที่ว่างสีเขียว" : "ไม่พบพื้นที่ว่างที่ยืนยันได้";
    case "no-fit": return "ไม่พบจุดจอดที่พอดีกับรถคันนี้";
    case "preview":
      if (!hasDestination) return "ไม่พบจุดจอดที่พอดีกับรถคันนี้";
      return hasRoute ? "ไปตามเส้นสีน้ำเงิน" : "จอดตรงจุดที่ลูกศรชี้";
  }
}

const RIGHT_ACCESS_X = 28.9;
const LOWER_AISLE_Y = 3;

/** Waypoints for the Sripatum synthetic scene through the opening beside the planters. */
export function sripatumPreviewRoute(map: LotMap, siteId: string, destination: MetricPoint | undefined): MetricPoint[] | undefined {
  if (siteId !== "sripatum" || !destination || !map.areas.some(({ live }) => live?.source === "SYNTHETIC_FIXTURE")) return;
  const entrance = map.landmarks.find(({ landmark_id, kind }) => landmark_id === "entrance-1" && kind === "ENTRANCE");
  if (!entrance) return;
  return [entrance.position, { x_m: entrance.position.x_m, y_m: -8 }, { x_m: RIGHT_ACCESS_X, y_m: -8 }, { x_m: RIGHT_ACCESS_X, y_m: LOWER_AISLE_Y }, { x_m: destination.x_m, y_m: LOWER_AISLE_Y }, destination];
}

/** The preview points to an existing engine placement for its standard footprint. */
export function guardBoothPreviewDestination(map: LotMap, mode: GuardBoothMode) {
  if (mode !== "preview") return null;
  for (const area of map.areas) {
    const placement = area.regions.find(({ kind }) => kind === "AVAILABLE");
    if (placement) {
      return { point: labelPoint(placement.polygon), polygon: placement.polygon, text: "จุดแนะนำ", destination: true };
    }
  }
  return null;
}
