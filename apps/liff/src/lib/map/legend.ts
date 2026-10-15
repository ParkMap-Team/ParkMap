import type { LandmarkKind, LotLandmark, MetricPoint } from "../api/types.ts";
import { STATUS_LABELS } from "../parking/presentation.ts";
import { labelPoint } from "./geometry.ts";
import type { LotMap, MapStatus, MapSummary, UnknownReason } from "./lot-map.ts";

// Words for what the map shows. Nothing here promises a space: a candidate region is where the
// API found room at processing time, never a reservation, a stall, or a count of free spaces.

/** How each status is drawn besides its colour, so colour is never the only cue. */
export type StatusMark = "solid" | "dashed" | "motorcycle" | "hatch" | "dots" | "plain";

export const STATUS_TEXT: Record<MapStatus, { label: string; detail: string; mark: StatusMark }> = {
  AVAILABLE: {
    label: "มีพื้นที่จอด",
    detail: "ระบบพบพื้นที่ว่างพอสำหรับรถจักรยานยนต์ ณ เวลาที่ประมวลผล อาจเปลี่ยนไปก่อนที่คุณจะไปถึง",
    mark: "solid",
  },
  ALMOST_AVAILABLE: {
    label: "อาจจอดได้หากมีการขยับรถ",
    detail: "เป็นข้อมูลแนะนำเท่านั้น พื้นที่นี้จะพอจอดได้ก็ต่อเมื่อรถที่อยู่ใกล้เคียงขยับออกไป",
    mark: "dashed",
  },
  OCCUPIED: {
    label: "มีรถจอดอยู่",
    detail: "ตำแหน่งรถที่ระบบตรวจพบ แสดงด้วยขนาดรถมาตรฐาน ไม่ใช่ขนาดหรือรุ่นจริงของรถ",
    mark: "motorcycle",
  },
  UNKNOWN: {
    label: "ยังยืนยันสถานะไม่ได้",
    detail: "ระบบยังยืนยันไม่ได้ว่าพื้นที่ส่วนนี้ว่างหรือไม่ อย่าถือว่าเป็นที่ว่าง",
    mark: "hatch",
  },
  MONITORED: {
    label: "พื้นที่ตรวจสอบ",
    detail: "อยู่ในมุมกล้อง แต่ระบบไม่ได้ระบุว่าเป็นพื้นที่ว่างตรงจุดนี้",
    mark: "plain",
  },
  UNMONITORED: {
    label: "อยู่นอกพื้นที่ตรวจสอบ",
    detail: "กล้องไม่ได้ดูแลส่วนนี้ ระบบจึงไม่รู้สถานะ",
    mark: "dots",
  },
};

/** The legend lists what can appear on the map, in the order a student reads it. */
export const LEGEND_ORDER: MapStatus[] = ["AVAILABLE", "ALMOST_AVAILABLE", "OCCUPIED", "UNKNOWN", "UNMONITORED"];

/** Why ground is unknown, only as far as the API says; an UNKNOWN region carries no reason. */
export function unknownReasonText(reason: UnknownReason): string | null {
  if (reason === "LOADING") return "กำลังโหลดสถานะ";
  if (reason === "UNPROVEN") return null;
  return STATUS_LABELS[reason];
}

export const LANDMARK_LABELS: Record<LandmarkKind, string> = {
  ENTRANCE: "ทางเข้า",
  EXIT: "ทางออก",
  ENTRANCE_EXIT: "ทางเข้า-ออก",
  GUARD_BOOTH: "ป้อมยาม",
  BUILDING: "อาคาร",
  AISLE: "ทางเดินรถ",
  BARRIER: "แนวกั้น",
  TREE: "ต้นไม้",
  ROAD: "ถนน",
  WALKWAY: "ทางเดิน",
  PLANTING: "แนวต้นไม้",
  SHELTER: "ทางเดินมีหลังคา",
};

/** Ways in and out and the booth tell students where to go, so they are labelled even without a name. */
const WAYFINDING_KINDS: ReadonlySet<LandmarkKind> = new Set(["ENTRANCE", "EXIT", "ENTRANCE_EXIT", "GUARD_BOOTH"]);

/** Entrances, exits, and the booth always say what they are; other landmarks prefer their name. */
export function landmarkLabel({ kind, name }: Pick<LotLandmark, "kind" | "name">): string {
  if (WAYFINDING_KINDS.has(kind)) return name ? `${LANDMARK_LABELS[kind]} ${name}` : LANDMARK_LABELS[kind];
  return name ?? LANDMARK_LABELS[kind];
}

/** Parking areas have no names in the lot model, so they are numbered only when there are several. */
export function areaLabel(map: LotMap, parkingAreaId: string): string {
  if (map.areas.length === 1) return "พื้นที่ตรวจสอบ";
  return `พื้นที่ตรวจสอบ ${map.areas.findIndex((area) => area.parkingAreaId === parkingAreaId) + 1}`;
}

/**
 * One sentence for the whole site, announced politely when it changes. It names what the map
 * shows, never how many spaces there are.
 */
export function headline(summary: MapSummary, connectionLost: boolean): string {
  if (summary.loading) return connectionLost ? "เชื่อมต่อข้อมูลไม่ได้" : "กำลังโหลดสถานะ";
  if (summary.currentAreas === 0) return "ยังยืนยันสถานะล่าสุดไม่ได้";
  const status = headlineStatus(summary);
  return status ? STATUS_TEXT[status].label : "ยังไม่พบพื้นที่จอดที่ยืนยันได้";
}

/** The status the headline names, so its swatch matches; null when it names none. */
export function headlineStatus(summary: MapSummary): "AVAILABLE" | "ALMOST_AVAILABLE" | null {
  if (summary.loading || summary.currentAreas === 0) return null;
  if (summary.present.has("AVAILABLE")) return "AVAILABLE";
  if (summary.present.has("ALMOST_AVAILABLE")) return "ALMOST_AVAILABLE";
  return null;
}

export type MapLabel = { id: string; text: string; anchor: MetricPoint; kind: LandmarkKind | "AREA"; landmark: LotLandmark | null };

/**
 * Every static label: named landmarks, ways in and out, and the monitored areas. An unnamed tree or
 * road would only repeat its kind, so it is not labelled. Live state never adds a label.
 */
export function mapLabels(map: LotMap): MapLabel[] {
  return [
    ...map.landmarks.filter((landmark) => landmark.name || WAYFINDING_KINDS.has(landmark.kind)).map((landmark) => ({ id: `landmark:${landmark.landmark_id}`, text: landmarkLabel(landmark), anchor: landmark.position, kind: landmark.kind, landmark })),
    ...map.areas.map((area) => ({ id: `area:${area.parkingAreaId}`, text: areaLabel(map, area.parkingAreaId), anchor: labelPoint(area.polygon), kind: "AREA" as const, landmark: null })),
  ];
}
