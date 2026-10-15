import type { AreaLiveStatus, ParkingAreaLiveState, SiteParkingState, StateSourceKind } from "../api/types.ts";

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
      return { ...area, status: "STALE", age_s: ageS, regions: [], motorcycles: [] };
    }
    return { ...area, age_s: ageS };
  });
}

export const STATUS_LABELS: Record<AreaLiveStatus, string> = {
  LIVE: "ข้อมูลล่าสุด",
  DEMO: "ข้อมูลสาธิต",
  STALE: "ข้อมูลไม่เป็นปัจจุบัน",
  NO_DATA: "ยังไม่มีข้อมูล",
  NOT_CALIBRATED: "ยังไม่ได้ตั้งค่ากล้อง",
  CALIBRATION_MISMATCH: "การตั้งค่ากล้องเปลี่ยน กำลังรอข้อมูลใหม่",
};

const SOURCE_NOTICES: Partial<Record<StateSourceKind, string>> = {
  RECORDED_REPLAY: "กำลังแสดงข้อมูลจากวิดีโอที่บันทึกไว้ ไม่ใช่ภาพสด",
  STILL_IMAGE_LOOP: "ข้อมูลสาธิตจากภาพถ่ายที่บันทึกไว้ ไม่ใช่สถานะลานจอดปัจจุบัน",
  SYNTHETIC_FIXTURE: "กำลังแสดงข้อมูลจำลองสำหรับการพัฒนา ไม่ใช่ข้อมูลจริง",
};

/** A notice whenever any area is not showing a live camera. Returns null only for live camera data. */
export function sourceNotice(areas: ParkingAreaLiveState[]): string | null {
  for (const source of ["SYNTHETIC_FIXTURE", "STILL_IMAGE_LOOP", "RECORDED_REPLAY"] as const) {
    if (areas.some((area) => area.source === source)) return SOURCE_NOTICES[source] ?? null;
  }
  return null;
}

/** A short badge for where the shown state comes from. A still-image loop is never called live. */
export function sourceBadge(areas: ParkingAreaLiveState[]): string | null {
  if (areas.some((area) => area.source === "SYNTHETIC_FIXTURE")) return "ข้อมูลจำลอง";
  if (areas.some((area) => area.source === "STILL_IMAGE_LOOP")) return "ข้อมูลสาธิต";
  if (areas.some((area) => area.source === "RECORDED_REPLAY")) return "วิดีโอบันทึก";
  if (areas.some((area) => area.source === "LIVE_CAMERA")) return "กล้องสด";
  return null;
}

const PHOTO_TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
const CLOCK_TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", timeStyle: "medium" });

/** When a demo photo was taken; the lot looked like this then, not now. */
export function photoTimeLabel(observedAt: string): string {
  return `ภาพถ่ายเมื่อ ${PHOTO_TIME.format(new Date(observedAt))}`;
}

/** A Bangkok wall-clock time; a still-image photo also needs its date, so it uses `photoTimeLabel`. */
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

/**
 * The three times a reader may need, kept apart: when the picture was taken, when the API
 * processed it, and when this browser received the answer.
 */
export function timeLines(area: ParkingAreaLiveState | null, receivedAt: number | null): TimeLine[] {
  const lines: TimeLine[] = [];
  if (area?.observed_at) {
    lines.push(
      area.source === "STILL_IMAGE_LOOP"
        ? { label: "ภาพถ่าย", value: PHOTO_TIME.format(new Date(area.observed_at)) }
        : { label: "ภาพจากกล้อง", value: clockTime(area.observed_at) },
    );
  }
  if (area?.processed_at) lines.push({ label: "ประมวลผล", value: clockTime(area.processed_at) });
  if (receivedAt) lines.push({ label: "รับข้อมูล", value: clockTime(receivedAt) });
  return lines;
}

/**
 * Every map colour. Status colours are never the only cue: each status also has its own
 * stroke or pattern (see `src/lib/map/legend.ts`). Landmarks avoid green, yellow, and red.
 */
export const COLORS = {
  AVAILABLE: "#16a34a",
  AVAILABLE_STROKE: "#166534",
  ALMOST_AVAILABLE: "#facc15",
  ALMOST_AVAILABLE_STROKE: "#854d0e",
  OCCUPIED: "#dc2626",
  UNKNOWN: "#94a3b8",
  UNKNOWN_HATCH: "#475569",
  UNMONITORED: "#3f3f46",
  UNMONITORED_DOT: "#a1a1aa",
  PARKING_AREA: "#eef0f3",
  PARKING_AREA_STROKE: "#64748b",
  LOT: "#c9cdd3",
  MOTORCYCLE: "#64748b",
  SELECTED: "#0f172a",
  SELECTED_HALO: "#ffffff",
  ENTRANCE: "#1d4ed8",
  EXIT: "#334155",
  GUARD_BOOTH: "#7c3aed",
  BUILDING: "#94a3b8",
  BARRIER: "#78716c",
  AISLE: "#e2e8f0",
} as const;
