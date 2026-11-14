import type { LandmarkKind, LotLandmark } from "../api/types.ts";
import { COLORS } from "../parking/presentation.ts";

// How landmarks look in both map views. A raised footprint is seen from above by its top, so the
// 2D plan uses the same colour as the top of the 3D block. Nothing here uses a status colour.

const FLAT: Record<LandmarkKind, string> = {
  ENTRANCE: COLORS.ENTRANCE,
  EXIT: COLORS.EXIT,
  ENTRANCE_EXIT: COLORS.ENTRANCE,
  GUARD_BOOTH: COLORS.GUARD_BOOTH,
  BUILDING: COLORS.BUILDING,
  AISLE: COLORS.AISLE,
  BARRIER: COLORS.BARRIER,
  TREE: COLORS.TREE_CANOPY,
  ROAD: COLORS.ROAD,
  WALKWAY: COLORS.WALKWAY,
  PLANTING: COLORS.PLANTING,
  SHELTER: COLORS.SHELTER,
};

const RAISED_TOP: Partial<Record<LandmarkKind, string>> = {
  BUILDING: COLORS.ROOF,
  PLANTING: COLORS.PLANTING_RAISED,
};

const RAISED_WALL: Partial<Record<LandmarkKind, string>> = {
  GUARD_BOOTH: COLORS.FACADE,
  BUILDING: COLORS.FACADE,
  PLANTING: COLORS.PLANTING_RAISED,
};

/** The colour of a footprint seen from above. */
export function landmarkTop({ kind, height_m }: Pick<LotLandmark, "kind" | "height_m">): string {
  return (height_m && RAISED_TOP[kind]) || FLAT[kind];
}

/** The colour of a raised footprint's walls. */
export function landmarkWall(kind: LandmarkKind): string {
  return RAISED_WALL[kind] ?? FLAT[kind];
}

export type Facade = NonNullable<LotLandmark["facade"]> | "PLAIN";

/**
 * Wall colour of a raised building by its facade. The 3D view draws the same generic storey of
 * windows for every building of a facade type: it says what kind of walls a building has, not
 * where its real windows are, which the lot model does not record.
 */
export const FACADE_WALLS: Record<Facade, string> = {
  PLAIN: COLORS.FACADE,
  WINDOW_BANDS: COLORS.BANDED_WALL,
  BRICK_AND_GLASS: COLORS.BRICK,
};

/** Kinds drawn as plain ground with no outline; the others keep a white edge so they read as features. */
export const GROUND_KINDS: ReadonlySet<LandmarkKind> = new Set(["ROAD", "WALKWAY", "PLANTING"]);

/** Colours of the generic detail the 3D view adds to landmarks: glazing, steel, kerbs, soil, shrubs, and road marks. */
export const DETAIL = {
  GLASS: "#4f6478",
  GLASS_LIGHT: "#8aa1b5",
  GLASS_DARK: "#33414e",
  GLASS_SHADE: "#3a4856",
  MULLION: "#dde1e4",
  FRAME: "#e8e4dc",
  SILL: "#d9d6cf",
  WALL_JOINT: "#dcdcd6",
  MORTAR: "#87503e",
  PLINTH: "#8d8b86",
  STEEL: "#7c848e",
  ROOF_EDGE: "#6b6560",
  KERB: "#d4d1c9",
  SOIL: "#6e5d4b",
  SHRUB: "#6a8c55",
  LANE_MARK: "#f2efe6",
  PAVER_JOINT: "#cfc8bc",
  // The site's paving in the 3D view: roads, the lot where no status covers it, and the ground around it.
  ASPHALT: "#6c7279",
} as const;
