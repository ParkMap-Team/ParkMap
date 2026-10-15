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

/** Wall and window colours of a raised building's facade; a building without one is plain with windows. */
export const FACADES: Record<Facade, { wall: string; window: string }> = {
  PLAIN: { wall: COLORS.FACADE, window: COLORS.FACADE_WINDOW },
  WINDOW_BANDS: { wall: COLORS.BANDED_WALL, window: COLORS.BANDED_WINDOW },
  BRICK_AND_GLASS: { wall: COLORS.BRICK, window: COLORS.GLASS },
};

/** Kinds drawn as plain ground with no outline; the others keep a white edge so they read as features. */
export const GROUND_KINDS: ReadonlySet<LandmarkKind> = new Set(["ROAD", "WALKWAY", "PLANTING"]);
