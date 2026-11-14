import type { MetricPoint, MetricPolygon } from "../api/types.ts";
import { pointInPolygon } from "./geometry.ts";

// Generic architectural detail the 3D view draws on the lot model's static landmarks: storeys and
// a parapet on a building, a glazed band on a booth, a kerb and shrubs in a planter, centre-line
// dashes, edge lines, and lane arrows on a road. Every size here is a typical one, not a survey. Detail dresses a recorded
// footprint and height: it never adds a landmark and never reaches above the recorded height.

/** A stable number in [0, 1) for a key, so the same landmark always looks the same. */
export function hash01(text: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0) / 2 ** 32;
}

interface Direction {
  x: number;
  y: number;
}

/** The ring without a closing copy of its first point or repeated points. */
function openRing(ring: MetricPoint[]): MetricPoint[] {
  const points = ring.filter((point, index) => {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    return index === 0 || point.x_m !== previous.x_m || point.y_m !== previous.y_m;
  });
  const [first] = points;
  const last = points[points.length - 1];
  return points.length > 1 && first.x_m === last.x_m && first.y_m === last.y_m ? points.slice(0, -1) : points;
}

/** Positive for a counter-clockwise ring. */
function signedArea(ring: MetricPoint[]): number {
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point.x_m * next.y_m - next.x_m * point.y_m;
  }, 0) / 2;
}

/** The unit normal to the left of the edge from `start` to `end`. */
function leftNormal(start: MetricPoint, end: MetricPoint): Direction {
  const length = Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m);
  return { x: -(end.y_m - start.y_m) / length, y: (end.x_m - start.x_m) / length };
}

// A sharp corner's mitred offset grows without bound; this caps it at four times the distance.
const MIN_MITER = 1 / 8;

/** The ring moved `distanceM` toward its inside, or outward when negative. Each edge stays parallel to its original. */
export function offsetRing(ring: MetricPoint[], distanceM: number): MetricPoint[] {
  const points = openRing(ring);
  const inward = signedArea(points) >= 0 ? distanceM : -distanceM;
  return points.map((point, index) => {
    const before = leftNormal(points[(index - 1 + points.length) % points.length], point);
    const after = leftNormal(point, points[(index + 1) % points.length]);
    const scale = inward / Math.max(MIN_MITER, 1 + before.x * after.x + before.y * after.y);
    return { x_m: point.x_m + (before.x + after.x) * scale, y_m: point.y_m + (before.y + after.y) * scale };
  });
}

/** The polygon shrunk by `distanceM`, or grown when negative; null when shrinking would collapse it. */
export function insetPolygon([outer, ...holes]: MetricPolygon, distanceM: number): MetricPolygon | null {
  const original = openRing(outer);
  const moved = offsetRing(original, distanceM);
  // A ring shrunk past its own width turns its edges around, even where its area keeps its sign.
  const collapsed = original.some((point, index) => {
    const next = (index + 1) % original.length;
    return (
      (moved[next].x_m - moved[index].x_m) * (original[next].x_m - point.x_m) + (moved[next].y_m - moved[index].y_m) * (original[next].y_m - point.y_m) <= 0
    );
  });
  if (collapsed) return null;
  return [moved, ...holes.map((hole) => offsetRing(hole, -distanceM))];
}

/** A band `widthM` wide inside the polygon's outer edge, such as a kerb or a parapet; null when the polygon is narrower. */
export function edgeBand(polygon: MetricPolygon, widthM: number): MetricPolygon | null {
  const inner = insetPolygon([polygon[0]], widthM);
  return inner && [openRing(polygon[0]), inner[0]];
}

/** Axes along a polygon's longest edge and across it, and the polygon's extent on each, in metres. */
export interface Frame {
  along: Direction;
  across: Direction;
  alongMin: number;
  alongMax: number;
  acrossMin: number;
  acrossMax: number;
}

export function frameOf([outer]: MetricPolygon): Frame {
  const points = openRing(outer);
  let along: Direction = { x: 1, y: 0 };
  let longest = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const length = Math.hypot(next.x_m - point.x_m, next.y_m - point.y_m);
    if (length > longest) {
      longest = length;
      along = { x: (next.x_m - point.x_m) / length, y: (next.y_m - point.y_m) / length };
    }
  });
  const across = { x: -along.y, y: along.x };
  const alongs = points.map((point) => point.x_m * along.x + point.y_m * along.y);
  const acrosses = points.map((point) => point.x_m * across.x + point.y_m * across.y);
  return {
    along,
    across,
    alongMin: Math.min(...alongs),
    alongMax: Math.max(...alongs),
    acrossMin: Math.min(...acrosses),
    acrossMax: Math.max(...acrosses),
  };
}

function framePoint({ along, across }: Frame, alongM: number, acrossM: number): MetricPoint {
  return { x_m: along.x * alongM + across.x * acrossM, y_m: along.y * alongM + across.y * acrossM };
}

/** The angle of the frame's long axis from metric +x, counter-clockwise. */
export function frameHeading({ along }: Frame): number {
  return Math.atan2(along.y, along.x);
}

/** Storeys of a raised building: a recessed glazed ground floor and a parapet, when it is tall enough to have them. */
export const BUILDING_TIERS = { minHeightM: 8, storeyM: 3.6, groundM: 4.5, recessM: 0.8, parapetM: 1, parapetWidthM: 0.35 };

export function buildingTiers(heightM: number): { groundM: number; parapetM: number } {
  return heightM >= BUILDING_TIERS.minHeightM ? { groundM: BUILDING_TIERS.groundM, parapetM: BUILDING_TIERS.parapetM } : { groundM: 0, parapetM: 0 };
}

/** A booth: solid walls to sill height, glazing above, and a thin roof that overhangs the walls. */
export const BOOTH_TIERS = { minHeightM: 1.8, sillShare: 0.38, roofM: 0.2, overhangM: 0.25, glassRecessM: 0.04 };

export function boothTiers(heightM: number): { sillM: number; roofM: number } {
  return { sillM: heightM * BOOTH_TIERS.sillShare, roofM: Math.min(BOOTH_TIERS.roofM, heightM * 0.1) };
}

/** A raised planter: a concrete kerb to at most half its height, and shrubs above it to its recorded height. */
export const PLANTER = { kerbM: 0.3, kerbWidthM: 0.15, soilDropM: 0.05 };

export function planterTiers(heightM: number): { kerbM: number; canopyM: number } {
  const kerbM = Math.min(PLANTER.kerbM, heightM / 2);
  return { kerbM, canopyM: heightM - kerbM };
}

export interface Shrub {
  point: MetricPoint;
  /** In (0, 1]: a fraction of the full shrub, so no shrub rises above the planter's recorded height. */
  size: number;
  /** In [-0.5, 0.5): how far its shade departs from the base colour. */
  tint: number;
  turnRad: number;
}

export const SHRUB = { spacingM: 0.9, radiusM: 0.55, maxPerPlanting: 1500 };

/**
 * Shrubs in rows along a planting's long axis, a little out of line, each kept inside the polygon
 * so a canopy does not hang far over the kerb. A large planting spaces them wider, so the count stays bounded.
 */
export function shrubLayout(key: string, polygon: MetricPolygon): Shrub[] {
  const frame = frameOf(polygon);
  const length = frame.alongMax - frame.alongMin;
  const width = frame.acrossMax - frame.acrossMin;
  const spacing = Math.max(SHRUB.spacingM, Math.sqrt((length * width) / SHRUB.maxPerPlanting));
  const columns = Math.max(1, Math.round(length / spacing));
  const rows = Math.max(1, Math.round(width / spacing));
  const inner = insetPolygon(polygon, SHRUB.radiusM / 2) ?? polygon;
  const shrubs: Shrub[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const seed = `${key}:${row}:${column}`;
      const jitter = (salt: number) => (hash01(seed, salt) - 0.5) * spacing * 0.4;
      const point = framePoint(
        frame,
        frame.alongMin + ((column + 0.5) * length) / columns + jitter(1),
        frame.acrossMin + ((row + 0.5) * width) / rows + jitter(2),
      );
      if (!pointInPolygon(point, inner)) continue;
      shrubs.push({ point, size: 0.75 + 0.25 * hash01(seed, 3), tint: hash01(seed, 4) - 0.5, turnRad: hash01(seed, 5) * Math.PI * 2 });
    }
  }
  return shrubs;
}

/** A painted stripe lying flat on the ground. */
export interface Stripe {
  center: MetricPoint;
  headingRad: number;
  lengthM: number;
  widthM: number;
}

/** Road markings go on a road wide enough for two lanes and at least twice as long as it is wide. */
export const LANE = { minWidthM: 4, dashM: 3, gapM: 3, widthM: 0.12, edgeInsetM: 0.3, edgeWidthM: 0.1 };

/** The road's long axis and extents, or null when it is too narrow or short to be marked. */
function markedRoad(polygon: MetricPolygon): { frame: Frame; length: number; width: number } | null {
  const frame = frameOf(polygon);
  const length = frame.alongMax - frame.alongMin;
  const width = frame.acrossMax - frame.acrossMin;
  return width < LANE.minWidthM || length < width * 2 ? null : { frame, length, width };
}

/** Centre-line dashes. Half a road's width is left clear at each end, where it meets another road. */
export function laneDashes(polygon: MetricPolygon): Stripe[] {
  const road = markedRoad(polygon);
  if (!road) return [];
  const { frame, length, width } = road;
  const period = LANE.dashM + LANE.gapM;
  const count = Math.floor((length - width + LANE.gapM) / period);
  const first = frame.alongMin + (length - (count * period - LANE.gapM)) / 2 + LANE.dashM / 2;
  const middle = (frame.acrossMin + frame.acrossMax) / 2;
  const headingRad = frameHeading(frame);
  return Array.from({ length: count }, (_, index) => framePoint(frame, first + index * period, middle))
    .filter((center) => pointInPolygon(center, polygon))
    .map((center) => ({ center, headingRad, lengthM: LANE.dashM, widthM: LANE.widthM }));
}

/** A solid line just inside each long side, clear of the ends as the dashes are. */
export function edgeLines(polygon: MetricPolygon): Stripe[] {
  const road = markedRoad(polygon);
  if (!road) return [];
  const { frame, length, width } = road;
  const middle = (frame.alongMin + frame.alongMax) / 2;
  const headingRad = frameHeading(frame);
  return [frame.acrossMin + LANE.edgeInsetM, frame.acrossMax - LANE.edgeInsetM]
    .map((across) => framePoint(frame, middle, across))
    .filter((center) => pointInPolygon(center, polygon))
    .map((center) => ({ center, headingRad, lengthM: length - width, widthM: LANE.edgeWidthM }));
}

/** A painted arrow lying flat on the ground, pointing along `headingRad`. */
export interface Arrow {
  center: MetricPoint;
  headingRad: number;
}

/** A lane arrow's shape, pointing along +x, and how far apart arrows repeat along a lane. */
export const ARROW = { lengthM: 3, headM: 1.1, headWidthM: 0.9, stemWidthM: 0.22, spacingM: 15 };

/**
 * Arrows down the middle of each lane of a marked road, as on a two-way road where traffic keeps
 * left: the lane left of the long axis heads along it, the other lane heads back. A road's full
 * width is left clear at each end, where it meets another road.
 */
export function laneArrows(polygon: MetricPolygon): Arrow[] {
  const road = markedRoad(polygon);
  if (!road) return [];
  const { frame, length, width } = road;
  const usable = length - 2 * width;
  if (usable < 0) return [];
  const count = Math.floor(usable / ARROW.spacingM) + 1;
  const first = frame.alongMin + width + (usable - (count - 1) * ARROW.spacingM) / 2;
  const middle = (frame.acrossMin + frame.acrossMax) / 2;
  const heading = frameHeading(frame);
  const lanes = [
    { across: middle + width / 4, headingRad: heading },
    { across: middle - width / 4, headingRad: heading + Math.PI },
  ];
  return lanes.flatMap(({ across, headingRad }) =>
    Array.from({ length: count }, (_, index) => framePoint(frame, first + index * ARROW.spacingM, across))
      .filter((center) => pointInPolygon(center, polygon))
      .map((center) => ({ center, headingRad })),
  );
}
