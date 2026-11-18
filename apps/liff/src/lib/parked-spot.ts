import type { MetricPoint } from "./api/types.ts";

/** Where the rider said they parked (ADR 0021): their own claim, never availability. */
export type ParkedSpotInput = { site_id: string; x_m: number; y_m: number };
export type ParkedSpot = ParkedSpotInput & { saved_at: string };

// The LINE settings service's own bounds (`ParkedSpot` in app/line_bot.py); it validates again.
const SITE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_COORDINATE_M = 10_000;

function coordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_M;
}

/** A browser-sent spot with exactly the fields the service stores, or null. */
export function parkedSpotInput(value: unknown): ParkedSpotInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { site_id, x_m, y_m, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof site_id !== "string" || !SITE_ID.test(site_id)) return null;
  return coordinate(x_m) && coordinate(y_m) ? { site_id, x_m, y_m } : null;
}

export function spotPoint(spot: ParkedSpotInput): MetricPoint {
  return { x_m: spot.x_m, y_m: spot.y_m };
}

// One fixed zone, so the server and the browser print the same time: the served lots are in Thailand.
const SAVED_AT = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** When the rider saved the spot, in Thai time. */
export function savedAtLabel(savedAt: string): string {
  return `บันทึกเมื่อ ${SAVED_AT.format(new Date(savedAt))} น.`;
}
