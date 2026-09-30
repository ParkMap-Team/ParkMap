import type { AreaLiveStatus, ParkingAreaLiveState, SiteParkingState, StateSourceKind } from "../api/types.ts";

/**
 * Areas as they may be shown now. The API decides freshness when it answers; the
 * browser only downgrades LIVE to STALE as the answer ages. It never upgrades a state.
 */
export function visibleAreas(state: SiteParkingState, receivedAgoS: number): ParkingAreaLiveState[] {
  return state.areas.map((area) => {
    if (area.status !== "LIVE") return area;
    const ageS = (area.age_s ?? 0) + Math.max(receivedAgoS, 0);
    if (receivedAgoS < 0 || ageS > state.freshness_limit_s) {
      return { ...area, status: "STALE", age_s: ageS, regions: [], motorcycles: [] };
    }
    return { ...area, age_s: ageS };
  });
}

export const STATUS_LABELS: Record<AreaLiveStatus, string> = {
  LIVE: "ข้อมูลล่าสุด",
  STALE: "ข้อมูลไม่เป็นปัจจุบัน",
  NO_DATA: "ยังไม่มีข้อมูล",
  NOT_CALIBRATED: "ยังไม่ได้ตั้งค่ากล้อง",
  CALIBRATION_MISMATCH: "การตั้งค่ากล้องเปลี่ยน กำลังรอข้อมูลใหม่",
};

const SOURCE_NOTICES: Partial<Record<StateSourceKind, string>> = {
  RECORDED_REPLAY: "กำลังแสดงข้อมูลจากวิดีโอที่บันทึกไว้ ไม่ใช่ภาพสด",
  SYNTHETIC_FIXTURE: "กำลังแสดงข้อมูลจำลองสำหรับการพัฒนา ไม่ใช่ข้อมูลจริง",
};

/** A notice whenever any area is not showing a live camera. Returns null only for live camera data. */
export function sourceNotice(areas: ParkingAreaLiveState[]): string | null {
  for (const source of ["SYNTHETIC_FIXTURE", "RECORDED_REPLAY"] as const) {
    if (areas.some((area) => area.source === source)) return SOURCE_NOTICES[source] ?? null;
  }
  return null;
}

export const COLORS = {
  AVAILABLE: "#22c55e",
  ALMOST_AVAILABLE: "#eab308",
  UNKNOWN: "#94a3b8",
  UNMONITORED: "#3f3f46",
  PARKING_AREA: "#d4d4d8",
  LOT: "#a1a1aa",
  MOTORCYCLE: "#1e293b",
} as const;
