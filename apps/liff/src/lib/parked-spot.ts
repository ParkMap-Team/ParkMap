import type { LotModel, MetricPoint, MetricPolygon } from "./api/types.ts";
import type { Bounds } from "./map/geometry.ts";
import { type LotMap, buildLotMap } from "./map/lot-map.ts";

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

/** What the parked screen frames: the ground around the spot, or the whole lot. */
export type SpotView = "spot" | "lot";

/** Ground kept on screen on each side of the spot in the close view, in metres. */
const SPOT_CONTEXT_M = 8;
/** The ring marking the spot on the ground: about a motorcycle's length across. */
const SPOT_RING_RADIUS_M = 1.2;
const SPOT_RING_SIDES = 32;

/** The smallest frame centred on `centre` that holds every point, so the spot's pin always has room over it. */
function frameAround(centre: MetricPoint, points: readonly MetricPoint[]): Bounds {
  const halfX = Math.max(...points.map((point) => Math.abs(point.x_m - centre.x_m)));
  const halfY = Math.max(...points.map((point) => Math.abs(point.y_m - centre.y_m)));
  return { minX: centre.x_m - halfX, minY: centre.y_m - halfY, maxX: centre.x_m + halfX, maxY: centre.y_m + halfY };
}

/**
 * The lot plan for the parked screen (ADR 0021), framed on the spot. Parking areas are drawn as plain
 * ground with no state, so the rider can place the spot in the lot while the screen says nothing about
 * availability. The whole-lot frame stays centred on the spot too, so its pin never meets an edge.
 */
export function parkedSpotMap(lotModel: LotModel, spot: ParkedSpotInput, view: SpotView): LotMap {
  const plan = buildLotMap(lotModel, []);
  const point = spotPoint(spot);
  const context = [
    { x_m: point.x_m - SPOT_CONTEXT_M, y_m: point.y_m - SPOT_CONTEXT_M },
    { x_m: point.x_m + SPOT_CONTEXT_M, y_m: point.y_m + SPOT_CONTEXT_M },
  ];
  const { minX, minY, maxX, maxY } = plan.bounds;
  const lot = [{ x_m: minX, y_m: minY }, { x_m: maxX, y_m: maxY }];
  return {
    ...plan,
    areas: plan.areas.map((area) => ({ ...area, unknownReason: null })),
    frame: frameAround(point, view === "lot" ? [...context, ...lot] : context),
  };
}

/** A ring on the ground around the spot, so the screen marks the place and not only a pin above it. */
export function spotRing(spot: ParkedSpotInput): MetricPolygon {
  const ring = Array.from({ length: SPOT_RING_SIDES }, (_, index) => {
    const angle = (index / SPOT_RING_SIDES) * 2 * Math.PI;
    return { x_m: spot.x_m + Math.cos(angle) * SPOT_RING_RADIUS_M, y_m: spot.y_m + Math.sin(angle) * SPOT_RING_RADIUS_M };
  });
  return [ring];
}

// One fixed zone, so the server and the browser print the same time: the served lots are in Thailand.
const SAVED_AT = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** When the rider saved the spot, in Thai time. */
export function savedAtLabel(savedAt: string): string {
  return `บันทึกเมื่อ ${SAVED_AT.format(new Date(savedAt))} น.`;
}
