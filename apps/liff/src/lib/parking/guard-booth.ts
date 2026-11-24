import type { GuardBoothFit, GuardBoothRider, MetricPoint, MetricPolygon } from "../api/types.ts";
import { boundsOf, labelPoint, pointInPolygon } from "../map/geometry.ts";
import type { LotMap } from "../map/lot-map.ts";

export type GuardBoothMode = "waiting" | "classifying" | "preview" | "fit-preview" | "unknown" | "no-fit" | "unavailable";
export type GuardBoothOverview = "entrance" | "parking";

/** Display names for the families the Guard Booth classifier and the fit previews use. */
const MODEL_NAMES: Record<string, string> = {
  aerox: "Yamaha Aerox",
  cbr650r: "Honda CBR650R",
  click: "Honda Click",
  fino: "Yamaha Fino",
  forza: "Honda Forza 350",
  grand_filano: "Yamaha Grand Filano",
  hd_road_glide: "Harley-Davidson Road Glide",
  nmax: "Yamaha NMAX",
  pcx: "Honda PCX",
  scoopy: "Honda Scoopy",
  wave: "Honda Wave",
  xmax: "Yamaha XMAX",
};

export function guardBoothModelName(family: string): string {
  return MODEL_NAMES[family] ?? family;
}

/** True for a family the Guard Booth names, which are the families the fit API has reference sizes for. */
export function isKnownFamily(family: string): boolean {
  return Object.hasOwn(MODEL_NAMES, family);
}

/** What the booth shows for a rider in the entrance clip. `fitFamily` is set only when the family has a reference size. */
export type EntranceClipOutcome = { mode: GuardBoothMode; family: string | null; fitFamily: string | null };

/** `null` means the clip could not be classified. */
export function entranceClipOutcome(rider: GuardBoothRider | null): EntranceClipOutcome {
  if (!rider?.family) return { mode: "unknown", family: null, fitFamily: null };
  // A family without a reference size gets no placement: a standard footprint may not hold it.
  if (!rider.reference_size) return { mode: "unknown", family: rider.family, fitFamily: null };
  return { mode: "fit-preview", family: rider.family, fitFamily: rider.family };
}

/** The longest wait between asks while the API is still classifying the entrance clip. */
export const CLASSIFICATION_RETRY_MAX_MS = 60_000;

/**
 * How long to wait before asking for the clip's riders again: the API answers 503 with `Retry-After`
 * while it is still classifying the clip. `undefined` when the answer is a failure, not a wait.
 */
export function classificationRetryMs(status: number, retryAfter: string | null): number | undefined {
  if (status !== 503 || retryAfter === null) return undefined;
  const seconds = Number(retryAfter);
  return Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds * 1000, CLASSIFICATION_RETRY_MAX_MS) : undefined;
}

/** The latest rider to have reached the booth zone by `time` seconds into the clip, or -1 before the first. */
export function arrivedRider(riders: readonly GuardBoothRider[], time: number): number {
  return riders.findLastIndex(({ arrival_s }) => arrival_s <= time);
}

/** At most this many riders are shown at once; another arrival drops the oldest. */
export const RIDER_QUEUE_LIMIT = 3;
/** A rider's card and map marker stay this long after the rider reaches the booth. */
export const RIDER_QUEUE_MS = 30_000;
/**
 * One colour per queue slot, apart from the status, route and hold colours and dark enough for
 * white text. The number and the rider's photo carry the same cue, so colour is never the only one.
 */
export const RIDER_COLORS = ["#6d28d9", "#be185d", "#c2410c"] as const satisfies readonly string[] & { length: typeof RIDER_QUEUE_LIMIT };

/**
 * A rider shown at the booth, newest first in a queue. `slot` picks its colour and number; `requestId`
 * is the rider's own fit request, so each rider is held a different place. `alone` says the queue was
 * empty when it arrived.
 */
export type QueuedRider = { seq: number; slot: number; alone: boolean; rider: GuardBoothRider; arrivedAt: number; requestId: string | undefined };

/** The riders still shown at `now`; the same queue when none has expired. */
export function activeRiders(queue: readonly QueuedRider[], now: number): readonly QueuedRider[] {
  const active = queue.filter(({ arrivedAt }) => now - arrivedAt < RIDER_QUEUE_MS);
  return active.length === queue.length ? queue : active;
}

/** Puts an arrival first, dropping expired riders and then the oldest beyond the limit, in the lowest free slot. */
export function enqueueRider(queue: readonly QueuedRider[], arrival: Omit<QueuedRider, "slot" | "alone">, now: number): readonly QueuedRider[] {
  const kept = activeRiders(queue, now).slice(0, RIDER_QUEUE_LIMIT - 1);
  const slot = RIDER_COLORS.findIndex((_, index) => !kept.some((queued) => queued.slot === index));
  return [{ ...arrival, slot, alone: kept.length === 0 }, ...kept];
}

/**
 * The rider whose route the map draws: only a rider that arrived alone and is still alone. Riders
 * close together get only their pins, so the route is never redrawn rider after rider.
 */
export function routeRiderSeq(queue: readonly QueuedRider[]): number | undefined {
  return queue.length === 1 && queue[0].alone ? queue[0].seq : undefined;
}

/** Where a rider's fit stands. */
export type RiderFit = "no-frame" | "pending" | "failed" | "no-space" | "placed" | "confirming" | "occupied";

export function canRetryBoothFit(answer: Pick<GuardBoothFit, "request_id" | "observed_at" | "stage"> | undefined, requestId: string | undefined, frame: string | null | undefined): boolean {
  return !!requestId && !!frame && answer?.stage === "RELEASED" && answer.request_id === requestId && answer.observed_at === frame;
}

export function boothFitStatus(answer: Pick<GuardBoothFit, "polygon" | "stage" | "reason"> | null, expired: boolean): RiderFit {
  if (!answer || answer.stage === "RELEASED") return "pending";
  if (answer.stage === "OCCUPIED_CONFIRMED") return "occupied";
  if (expired || answer.stage === "AWAITING_CONFIRMATION") return "confirming";
  if (answer.polygon) return "placed";
  return answer.reason === "NO_FIT" ? "no-space" : "failed";
}

/** What a rider is told to do: `go` to its pin, `wait` for a place, park in any `free` space, or `stop` because none was found. */
export type RiderGuide = { tone: "go" | "wait" | "free" | "stop"; text: string };

/** One short instruction per rider; a rider without a placement of its own is sent to the free space. */
export type BoothFreeGround = "free" | "none" | "unavailable";

export function riderGuide(rider: GuardBoothRider | null, fit: RiderFit, number: number, row?: string, ground: BoothFreeGround = "unavailable"): RiderGuide {
  if (!rider || !entranceClipOutcome(rider).fitFamily) {
    if (ground === "free") return { tone: "free", text: "จอดในพื้นที่สีเขียว" };
    return { tone: "stop", text: ground === "none" ? "ยังไม่พบพื้นที่ว่างที่ยืนยันได้" : "ยังยืนยันพื้นที่ว่างไม่ได้" };
  }
  switch (fit) {
    case "pending": return { tone: "wait", text: "กำลังหาที่จอด" };
    case "confirming": return { tone: "wait", text: "รอตรวจพื้นที่เดิม" };
    case "occupied": return { tone: "stop", text: "พื้นที่แนะนำมีรถแล้ว" };
    case "no-frame":
    case "failed": return { tone: "stop", text: "หาที่จอดไม่ได้" };
    case "no-space": return { tone: "stop", text: "ไม่มีที่ว่างพอสำหรับรุ่นนี้" };
    case "placed": return { tone: "go", text: row ? `ไปแถว ${row} · หมุด ${number}` : `ไปที่หมุด ${number}` };
  }
}

/** The rider's name at the booth; `null` means the clip could not be classified. */
export function riderTitle(rider: GuardBoothRider | null): string {
  if (!rider) return "ตรวจรุ่นรถไม่ได้";
  return rider.reason === "CLASSIFIED" && rider.family ? guardBoothModelName(rider.family) : "ไม่ทราบรุ่นรถ";
}

const CROP_PREFIX = "data:image/jpeg;base64,";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The crop is rendered only as an inline JPEG. */
export function entranceClipCrop(rider: GuardBoothRider | null): string | null {
  const url = rider?.preview_url;
  return url?.startsWith(CROP_PREFIX) && BASE64.test(url.slice(CROP_PREFIX.length)) ? url : null;
}

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
    case "fit-preview": return hasDestination ? "พบที่จอด" : "ไม่มีที่ว่างพอสำหรับรุ่นนี้";
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
