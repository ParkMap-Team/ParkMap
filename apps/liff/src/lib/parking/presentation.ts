import type { AreaLiveStatus, ParkingAreaLiveState, SiteParkingState } from "../api/types.ts";

/** LIVE is the lot now; DEMO is fresh processing of recorded photos. Nothing else shows regions. */
export function showsRegions(status: AreaLiveStatus): boolean {
  return status === "LIVE" || status === "DEMO";
}

/**
 * Areas as they may be shown now. The API decides freshness when it answers; the
 * browser only downgrades LIVE or DEMO to STALE as the answer ages, or when the latest
 * poll failed and the current state cannot be confirmed. It never upgrades a state.
 */
export function visibleAreas(state: SiteParkingState, receivedAgoS: number, connectionLost = false): ParkingAreaLiveState[] {
  return state.areas.map((area) => {
    if (!showsRegions(area.status)) return area;
    const ageS = (area.age_s ?? 0) + Math.max(receivedAgoS, 0);
    if (connectionLost || receivedAgoS < 0 || ageS > state.freshness_limit_s) {
      return { ...area, status: "STALE", age_s: ageS, regions: [], motorcycles: [], frame: null };
    }
    return { ...area, age_s: ageS };
  });
}

export const STATUS_LABELS: Record<AreaLiveStatus, string> = {
  LIVE: "ข้อมูลล่าสุด",
  // A still-image loop reads like the lot now (ADR 0017); the API still tells them apart.
  DEMO: "ข้อมูลล่าสุด",
  STALE: "ข้อมูลไม่เป็นปัจจุบัน",
  NO_DATA: "ยังไม่มีข้อมูล",
  NOT_CALIBRATED: "ยังไม่ได้ตั้งค่ากล้อง",
  CALIBRATION_MISMATCH: "การตั้งค่ากล้องเปลี่ยน กำลังรอข้อมูลใหม่",
};

const CLOCK_TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", timeStyle: "medium" });

/** A Bangkok wall-clock time. */
export function clockTime(at: string | number): string {
  return CLOCK_TIME.format(new Date(at));
}

/** A compact age such as "5 วินาทีที่แล้ว". */
export function agoLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
}

export type TimeLine = { label: string; value: string };

export type AreaPhoto = { id: string; url: string; width: number; height: number };

/** The photo each shown area was computed from. A stale or hidden area shows none. */
export function areaPhotos(areas: ParkingAreaLiveState[]): AreaPhoto[] {
  return areas.flatMap((area) => (showsRegions(area.status) && area.frame ? [{ id: area.parking_area_id, ...area.frame }] : []));
}

/**
 * The times a reader may need, kept apart: when the camera took the picture, when the API
 * processed it, and when this browser received the answer. A still-image loop's photo was taken
 * on another day, so its capture time is left out rather than shown as a time today.
 */
export function timeLines(area: ParkingAreaLiveState | null, receivedAt: number | null): TimeLine[] {
  const lines: TimeLine[] = [];
  if (area?.observed_at && area.source !== "STILL_IMAGE_LOOP") lines.push({ label: "ภาพจากกล้อง", value: clockTime(area.observed_at) });
  if (area?.processed_at) lines.push({ label: "ประมวลผล", value: clockTime(area.processed_at) });
  if (receivedAt) lines.push({ label: "รับข้อมูล", value: clockTime(receivedAt) });
  return lines;
}

/**
 * Every map colour. Status colours are never the only cue: each status also has its own
 * stroke or pattern (see `src/lib/map/legend.ts`). Landmarks avoid status green, yellow, and
 * red: planting is a muted sage, and every status layer is drawn over the surroundings.
 */
export const COLORS = {
  HELD: "#bae6fd",
  HELD_STROKE: "#075985",
  WIDTH_SUFFICIENT: "#4ade80",
  AVAILABLE: "#16a34a",
  AVAILABLE_STROKE: "#166534",
  ALMOST_AVAILABLE: "#facc15",
  ALMOST_AVAILABLE_STROKE: "#854d0e",
  OCCUPIED: "#b91c1c",
  UNKNOWN: "#94a3b8",
  // A mid slate on the light slate: the hatch stays distinct but recedes behind green and yellow.
  UNKNOWN_HATCH: "#64748b",
  UNMONITORED: "#3f444b",
  UNMONITORED_DOT: "#9aa0a8",
  // Paving grey, so the monitored area reads as a lot against the lighter ground.
  PARKING_AREA: "#d5d9de",
  PARKING_AREA_STROKE: "#64748b",
  LOT: "#c9cdd3",
  CURB: "#f8f9f6",
  MOTORCYCLE: "#64748b",
  SELECTED: "#0f172a",
  SELECTED_HALO: "#ffffff",
  ENTRANCE: "#1e40af",
  EXIT: "#334155",
  GUARD_BOOTH: "#57534e",
  BUILDING: "#bdb4a6",
  BARRIER: "#78716c",
  AISLE: "#e2e8f0",
  GROUND: "#e4e7e1",
  ROAD: "#8b929c",
  WALKWAY: "#ece8e1",
  PLANTING: "#c9d8bd",
  PLANTING_RAISED: "#8fae7e",
  TREE_CANOPY: "#7ea36c",
  TREE_TRUNK: "#8a6a4f",
  SHELTER: "#f1f5f9",
  FACADE: "#efe6d8",
  BANDED_WALL: "#f5f5f2",
  BRICK: "#9a5b45",
  ROOF: "#cfd6de",
} as const;

/**
 * Paints for the 3D motorcycle model, light to dark. Greys only, so a motorcycle never reads as a
 * status colour; the soft occupied glow under it carries the status.
 */
export const MOTORCYCLE_PAINTS = ["#f0f0f0", "#c4c4c4", "#7a7a7a", "#3a3a3a"] as const;
