import type { AreaLiveStatus, LiveRegion, LotLandmark, LotModel, MetricPoint, MetricPolygon, MotorcycleProxy, ParkingAreaLiveState } from "../api/types.ts";
import { showsRegions } from "../parking/presentation.ts";
import { type Bounds, boundsOf, labelPoint, pointInPolygon, proxyFootprint } from "./geometry.ts";

// One map model for both renderers: static place geometry from the lot model, with the API's
// current state laid over it. The browser never decides what is available; it only places what
// the API returned and treats everything without a current state as unknown.

/**
 * What a place on the map shows. OCCUPIED is a detected motorcycle's footprint. MONITORED is ground
 * with a current state that the API marked neither as a candidate space nor as unknown.
 */
export type MapStatus = "AVAILABLE" | "ALMOST_AVAILABLE" | "OCCUPIED" | "UNKNOWN" | "MONITORED" | "UNMONITORED";

/** Why ground is unknown: no state yet, the API returned the region as UNKNOWN, or the area has no current state. */
export type UnknownReason = "LOADING" | "UNPROVEN" | Exclude<AreaLiveStatus, "LIVE" | "DEMO">;

export type MapArea = {
  parkingAreaId: string;
  polygon: MetricPolygon;
  /** The area's state, or null while none has arrived. */
  live: ParkingAreaLiveState | null;
  /** Set when the whole area is unknown because it has no current state. */
  unknownReason: UnknownReason | null;
  regions: LiveRegion[];
  motorcycles: { proxy: MotorcycleProxy; footprint: MetricPolygon }[];
};

export type LotMap = {
  outline: MetricPolygon;
  unmonitored: MetricPolygon[];
  areas: MapArea[];
  landmarks: LotLandmark[];
  /** The outline and every landmark, so the overview frames the whole place. */
  bounds: Bounds;
};

function landmarkPoints(landmark: LotLandmark): MetricPoint[] {
  return [landmark.position, ...(landmark.line ?? []), ...(landmark.polygon?.[0] ?? [])];
}

/** `states` is null while the first answer is loading; an area missing from an answer has no data. */
export function buildLotMap(lotModel: LotModel, states: ParkingAreaLiveState[] | null): LotMap {
  const byId = new Map(states?.map((state) => [state.parking_area_id, state]));
  const landmarks = lotModel.landmarks ?? [];
  const areas = lotModel.parking_areas.map(({ parking_area_id, polygon }): MapArea => {
    const live = byId.get(parking_area_id) ?? null;
    if (!live || !showsRegions(live.status)) {
      const unknownReason: UnknownReason = states === null ? "LOADING" : live ? (live.status as UnknownReason) : "NO_DATA";
      return { parkingAreaId: parking_area_id, polygon, live, unknownReason, regions: [], motorcycles: [] };
    }
    return {
      parkingAreaId: parking_area_id,
      polygon,
      live,
      unknownReason: null,
      regions: live.regions ?? [],
      motorcycles: (live.motorcycles ?? []).map((proxy) => ({ proxy, footprint: proxyFootprint(proxy) })),
    };
  });
  return {
    outline: lotModel.outline,
    unmonitored: lotModel.unmonitored,
    areas,
    landmarks,
    bounds: boundsOf([...lotModel.outline[0], ...landmarks.flatMap(landmarkPoints)]),
  };
}

export type MapHit = { status: MapStatus; polygon: MetricPolygon; area: MapArea | null; unknownReason: UnknownReason | null };

/** What the map shows at a ground point, in drawing order from the top; null outside the lot. */
export function hitTest(map: LotMap, point: MetricPoint): MapHit | null {
  for (const area of map.areas) {
    if (!pointInPolygon(point, area.polygon)) continue;
    if (area.unknownReason) return { status: "UNKNOWN", polygon: area.polygon, area, unknownReason: area.unknownReason };
    const motorcycle = area.motorcycles.find(({ footprint }) => pointInPolygon(point, footprint));
    if (motorcycle) return { status: "OCCUPIED", polygon: motorcycle.footprint, area, unknownReason: null };
    for (let index = area.regions.length - 1; index >= 0; index--) {
      const region = area.regions[index];
      if (pointInPolygon(point, region.polygon)) {
        return { status: region.kind, polygon: region.polygon, area, unknownReason: region.kind === "UNKNOWN" ? "UNPROVEN" : null };
      }
    }
    return { status: "MONITORED", polygon: area.polygon, area, unknownReason: null };
  }
  const unmonitored = map.unmonitored.find((polygon) => pointInPolygon(point, polygon));
  return unmonitored ? { status: "UNMONITORED", polygon: unmonitored, area: null, unknownReason: null } : null;
}

/** A point the map can focus to show the first place with this status, or null when nothing has it. */
export function focusPoint(map: LotMap, status: MapStatus): MetricPoint | null {
  for (const area of map.areas) {
    if (status === "UNKNOWN" && area.unknownReason) return labelPoint(area.polygon);
    if (status === "OCCUPIED" && area.motorcycles.length > 0) return area.motorcycles[0].proxy.center;
    const region = area.regions.find((item) => item.kind === status);
    if (region) return labelPoint(region.polygon);
  }
  if (status === "UNMONITORED" && map.unmonitored.length > 0) return labelPoint(map.unmonitored[0]);
  return null;
}

export type MapSummary = {
  loading: boolean;
  /** Areas with a current state (LIVE or DEMO). */
  currentAreas: number;
  /** Areas that are unknown as a whole. */
  unknownAreas: number;
  present: Set<MapStatus>;
  /** Detected motorcycles in areas with a current state. It counts detections, not free spaces. */
  detectedMotorcycles: number;
};

export function summarize(map: LotMap): MapSummary {
  const present = new Set<MapStatus>();
  let detectedMotorcycles = 0;
  for (const area of map.areas) {
    if (area.unknownReason) present.add("UNKNOWN");
    for (const region of area.regions) present.add(region.kind);
    if (area.motorcycles.length > 0) present.add("OCCUPIED");
    detectedMotorcycles += area.motorcycles.length;
  }
  if (map.unmonitored.length > 0) present.add("UNMONITORED");
  return {
    loading: map.areas.some((area) => area.unknownReason === "LOADING"),
    currentAreas: map.areas.filter((area) => !area.unknownReason).length,
    unknownAreas: map.areas.filter((area) => area.unknownReason).length,
    present,
    detectedMotorcycles,
  };
}

/** A tapped place: the ground point and what it showed then. New data is checked against the same point. */
export type Selection = { point: MetricPoint; status: MapStatus };

export function selectAt(map: LotMap, point: MetricPoint): Selection | null {
  const hit = hitTest(map, point);
  return hit ? { point, status: hit.status } : null;
}

/**
 * What a selection shows in the current map. `change` is set when new data shows something else
 * at the selected point, or nothing at all, so the panel can say so instead of silently switching.
 */
export function followSelection(map: LotMap, selection: Selection): { hit: MapHit | null; change: { from: MapStatus; to: MapStatus | null } | null } {
  const hit = hitTest(map, selection.point);
  const to = hit?.status ?? null;
  return { hit, change: to === selection.status ? null : { from: selection.status, to } };
}
