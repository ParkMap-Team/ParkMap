"use client";

import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, type CanvasTexture, Color, CylinderGeometry, type ExtrudeGeometryOptions, type InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Shape, ShapeGeometry, Vector3 } from "three";
import type { LotLandmark, MetricPolygon } from "@/lib/api/types";
import { edgePoints, toWorld } from "@/lib/map/geometry";
import {
  BOOTH_TIERS,
  BUILDING_TIERS,
  PLANTER,
  SHRUB,
  boothTiers,
  buildingTiers,
  edgeBand,
  ARROW,
  edgeLines,
  hash01,
  insetPolygon,
  laneArrows,
  laneDashes,
  planterTiers,
  shrubLayout,
} from "@/lib/map/landmark-detail";
import { DETAIL, FACADE_WALLS, type Facade, GROUND_KINDS, landmarkTop, landmarkWall } from "@/lib/map/landmark-style";
import { COLORS } from "@/lib/parking/presentation";
import { HEIGHT, Outline, Surface, canvasTexture, grain, pattern, toShape } from "./scene-primitives";

// The lot model's static surroundings in the 3D view, dressed as a clean architectural model:
// storeys of windows on a building, a glazed booth under an overhanging roof, kerbed planters with
// shrubs, roads marked with centre dashes and edge lines, and paved walkways. All of it is generic detail on a recorded
// footprint and height (see `landmark-detail`), drawn with flat-coloured procedural patterns and no
// photographic texture, so it reads as a model of the place rather than a survey of it.

const SHELTER_ROOF_M = 0.2;
const SHELTER_POST_M = 0.15;
const SHELTER_POST_SPACING_M = 5;
// Wall patterns are drawn at this resolution; mipmaps blend them toward their average far away.
const PX_PER_M = 32;
const MAX_ANISOTROPY = 8;

type Paint = (u0: number, z0: number, u1: number, z1: number, fill: string | readonly [top: string, bottom: string]) => void;

/**
 * One repeating bay of a wall, `bayM` wide and `storeyM` tall, painted in metres from its bottom
 * left. Extruded walls take metres along the wall as u and 1 - height as v, so the repeat and offset
 * here put each tile's bottom on a storey line: the canvas bottom row is the mesh's base.
 */
function wallTile(bayM: number, storeyM: number, background: string, draw: (paint: Paint) => void): CanvasTexture {
  const width = Math.round(bayM * PX_PER_M);
  const height = Math.round(storeyM * PX_PER_M);
  const texture = canvasTexture(width, height, (context) => {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    draw((u0, z0, u1, z1, fill) => {
      const x = (u0 / bayM) * width;
      const y = height - (z1 / storeyM) * height;
      const h = ((z1 - z0) / storeyM) * height;
      if (typeof fill === "string") {
        context.fillStyle = fill;
      } else {
        const gradient = context.createLinearGradient(0, y, 0, y + h);
        gradient.addColorStop(0, fill[0]);
        gradient.addColorStop(1, fill[1]);
        context.fillStyle = gradient;
      }
      context.fillRect(x, y, ((u1 - u0) / bayM) * width, h);
    });
  });
  texture.repeat.set(1 / bayM, -1 / storeyM);
  texture.offset.set(0, 1 / storeyM);
  return texture;
}

const GLAZING = [DETAIL.GLASS_LIGHT, DETAIL.GLASS] as const;
const STOREY = BUILDING_TIERS.storeyM;

/** One storey of each facade type: generic, the same on every wall. */
const FACADES: Record<Facade, () => CanvasTexture> = {
  // A spandrel and a ribbon of glass per storey, mullions every bay.
  WINDOW_BANDS: () =>
    wallTile(1.5, STOREY, COLORS.BANDED_WALL, (paint) => {
      paint(0, 0, 1.5, 0.06, DETAIL.WALL_JOINT);
      paint(0, 0.94, 1.5, 1, DETAIL.SILL);
      paint(0, 1, 1.5, 3.2, GLAZING);
      paint(0, 3.1, 1.5, 3.2, DETAIL.GLASS_SHADE);
      paint(0, 1, 0.06, 3.2, DETAIL.MULLION);
    }),
  // Brick courses with a framed, divided window per bay.
  BRICK_AND_GLASS: () =>
    wallTile(3, STOREY, COLORS.BRICK, (paint) => {
      for (let z = 0.3; z < STOREY; z += 0.3) paint(0, z, 3, z + 0.03, DETAIL.MORTAR);
      paint(0.45, 0.85, 2.55, 2.85, DETAIL.FRAME);
      paint(0.5, 0.9, 2.5, 2.8, GLAZING);
      paint(1.47, 0.9, 1.53, 2.8, DETAIL.FRAME);
    }),
  // Rendered wall with a punched window per bay.
  PLAIN: () =>
    wallTile(3, STOREY, COLORS.FACADE, (paint) => {
      paint(0, 0, 3, 0.04, DETAIL.WALL_JOINT);
      paint(0.85, 0.95, 2.15, 2.45, DETAIL.FRAME);
      paint(0.9, 1, 2.1, 2.4, GLAZING);
      paint(0.8, 0.88, 2.2, 0.95, DETAIL.SILL);
    }),
};

/** A glazed ground floor on a stone plinth, with a mullion every bay and a transom. */
function storefront(): CanvasTexture {
  const groundM = BUILDING_TIERS.groundM;
  return wallTile(3, groundM, DETAIL.PLINTH, (paint) => {
    paint(0, 0.3, 3, groundM, [DETAIL.GLASS, DETAIL.GLASS_DARK]);
    paint(0, 3, 3, 3.1, DETAIL.MULLION);
    paint(0, 0.3, 0.1, groundM, DETAIL.MULLION);
  });
}

/** A booth's glazing: even top to bottom, so it fits a band of any height, with a mullion every metre. */
function boothGlass(): CanvasTexture {
  return wallTile(1, 1, DETAIL.GLASS, (paint) => paint(0, 0, 0.06, 1, DETAIL.MULLION));
}

/** Speckles of light and dark over a ground colour. */
function speckled(background: string, tileM: number, px: number, count: number, alpha: number, size: number): CanvasTexture {
  const random = grain(px + count);
  return pattern(
    background,
    (context) => {
      for (let index = 0; index < count; index += 1) {
        context.fillStyle = random() < 0.5 ? `rgba(255, 255, 255, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
        context.fillRect(random() * px, random() * px, size, size);
      }
    },
    tileM,
    px,
  );
}

/** Square pavers 0.6 m across, a little uneven in shade, with light joints. */
function pavers(): CanvasTexture {
  return pattern(
    COLORS.WALKWAY,
    (context) => {
      [0.03, 0, 0, 0.05].forEach((shade, index) => {
        context.fillStyle = `rgba(0, 0, 0, ${shade})`;
        context.fillRect((index % 2) * 32, Math.floor(index / 2) * 32, 32, 32);
      });
      context.fillStyle = DETAIL.PAVER_JOINT;
      for (const at of [0, 32]) {
        context.fillRect(at, 0, 2, 64);
        context.fillRect(0, at, 64, 2);
      }
    },
    1.2,
    64,
  );
}

interface DetailTextures {
  facades: Record<Facade, CanvasTexture>;
  storefront: CanvasTexture;
  boothGlass: CanvasTexture;
  pavers: CanvasTexture;
  grass: CanvasTexture;
}

function useDetailTextures(): DetailTextures {
  const gl = useThree((state) => state.gl);
  const textures = useMemo((): DetailTextures => {
    const made = {
      facades: { PLAIN: FACADES.PLAIN(), WINDOW_BANDS: FACADES.WINDOW_BANDS(), BRICK_AND_GLASS: FACADES.BRICK_AND_GLASS() },
      storefront: storefront(),
      boothGlass: boothGlass(),
      pavers: pavers(),
      grass: speckled(COLORS.PLANTING, 2, 64, 900, 0.08, 2),
    };
    // Walls and ground are mostly seen at a slant; this keeps their patterns from smearing.
    const anisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy());
    for (const texture of everyTexture(made)) texture.anisotropy = anisotropy;
    return made;
  }, [gl]);
  useEffect(() => () => everyTexture(textures).forEach((texture) => texture.dispose()), [textures]);
  return textures;
}

function everyTexture({ facades, ...rest }: DetailTextures): CanvasTexture[] {
  return [...Object.values(facades), ...Object.values(rest)];
}

/**
 * A footprint extruded from `base` up by `depth`, its top and bottom in `cap` and its walls in
 * `wall` or a wall pattern. Extruded along local +z, which the rotation turns to world up.
 */
function Prism({
  polygon,
  base,
  depth,
  cap,
  wall,
  map,
  castShadow = true,
}: {
  polygon: MetricPolygon;
  base: number;
  depth: number;
  cap: string;
  wall?: string;
  map?: CanvasTexture;
  castShadow?: boolean;
}) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  const options = useMemo((): ExtrudeGeometryOptions => ({ depth, bevelEnabled: false }), [depth]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, base, 0]} castShadow={castShadow} receiveShadow>
      <extrudeGeometry args={[shape, options]} />
      <meshLambertMaterial attach="material-0" color={cap} />
      <meshLambertMaterial attach="material-1" key={map?.uuid ?? "plain"} color={map ? "#ffffff" : wall} map={map} />
    </mesh>
  );
}

/** Storeys of the building's facade type over a recessed glazed ground floor, under a parapet. */
function Building({ landmark, polygon, height, textures }: { landmark: LotLandmark; polygon: MetricPolygon; height: number; textures: DetailTextures }) {
  const facade = landmark.facade ?? "PLAIN";
  const tiers = buildingTiers(height);
  const recessed = useMemo(() => (tiers.groundM > 0 ? insetPolygon(polygon, BUILDING_TIERS.recessM) : null), [polygon, tiers.groundM]);
  const parapet = useMemo(() => (tiers.parapetM > 0 ? edgeBand(polygon, BUILDING_TIERS.parapetWidthM) : null), [polygon, tiers.parapetM]);
  const top = landmarkTop(landmark);
  // A footprint too thin for a recess or a parapet goes without one.
  const body = { base: recessed ? tiers.groundM : 0, top: parapet ? height - tiers.parapetM : height };
  return (
    <>
      {recessed && <Prism polygon={recessed} base={0} depth={tiers.groundM} cap={top} map={textures.storefront} />}
      <Prism polygon={polygon} base={body.base} depth={body.top - body.base} cap={top} map={textures.facades[facade]} />
      {parapet && <Prism polygon={parapet} base={body.top} depth={tiers.parapetM} cap={top} wall={FACADE_WALLS[facade]} />}
    </>
  );
}

/** Solid walls to sill height, a band of glass set just inside them, and a dark roof that overhangs. */
function Booth({ landmark, polygon, height, textures }: { landmark: LotLandmark; polygon: MetricPolygon; height: number; textures: DetailTextures }) {
  const { sillM, roofM } = boothTiers(height);
  const glass = useMemo(() => insetPolygon(polygon, BOOTH_TIERS.glassRecessM) ?? polygon, [polygon]);
  const roof = useMemo(() => insetPolygon(polygon, -BOOTH_TIERS.overhangM) ?? polygon, [polygon]);
  const wall = landmarkWall(landmark.kind);
  return (
    <>
      <Prism polygon={polygon} base={0} depth={sillM} cap={wall} wall={wall} />
      <Prism polygon={glass} base={sillM} depth={height - roofM - sillM} cap={wall} map={textures.boothGlass} />
      <Prism polygon={roof} base={height - roofM} depth={roofM} cap={landmarkTop(landmark)} wall={DETAIL.ROOF_EDGE} />
    </>
  );
}

/** A concrete kerb around a bed of soil; the shrubs in it are drawn together by `Shrubs`. */
function Planter({ polygon, height }: { polygon: MetricPolygon; height: number }) {
  const { kerbM } = planterTiers(height);
  const kerb = useMemo(() => edgeBand(polygon, PLANTER.kerbWidthM), [polygon]);
  const bed = useMemo(() => insetPolygon(polygon, PLANTER.kerbWidthM), [polygon]);
  if (!kerb || !bed) return <Prism polygon={polygon} base={0} depth={kerbM} cap={DETAIL.SOIL} wall={DETAIL.KERB} />;
  return (
    <>
      <Prism polygon={kerb} base={0} depth={kerbM} cap={DETAIL.KERB} wall={DETAIL.KERB} />
      <Prism polygon={bed} base={0} depth={kerbM - PLANTER.soilDropM} cap={DETAIL.SOIL} wall={DETAIL.SOIL} castShadow={false} />
    </>
  );
}

const instanceMatrix = new Matrix4();
const instanceRotation = new Quaternion();
const instanceColor = new Color();
const UP = new Vector3(0, 1, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);

/** Every raised planting's shrubs in one instanced draw, each a low-poly mound from the kerb up to the recorded height. */
function Shrubs({ plantings }: { plantings: LotLandmark[] }) {
  const shrubs = useMemo(
    () =>
      plantings.flatMap((planting) => {
        const { kerbM, canopyM } = planterTiers(planting.height_m!);
        return shrubLayout(planting.landmark_id, planting.polygon!).map((shrub) => ({ ...shrub, kerbM, canopyM }));
      }),
    [plantings],
  );
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    shrubs.forEach(({ point, size, tint, turnRad, kerbM, canopyM }, index) => {
      const radius = SHRUB.radiusM * size;
      instanceRotation.setFromAxisAngle(UP, turnRad);
      instanceMatrix.compose(new Vector3(...toWorld(point, kerbM)), instanceRotation, new Vector3(radius, canopyM * size, radius));
      mesh.current!.setMatrixAt(index, instanceMatrix);
      mesh.current!.setColorAt(index, instanceColor.set(DETAIL.SHRUB).offsetHSL(tint * 0.04, 0, tint * 0.1));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [shrubs, invalidate]);
  if (shrubs.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, shrubs.length]} key={shrubs.length} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 1]} />
      {/* White, so each shrub shows its own instance colour. */}
      <meshLambertMaterial color="#ffffff" flatShading />
    </instancedMesh>
  );
}

/** Every road's centre dashes and edge lines in one instanced draw. */
function RoadMarks({ roads }: { roads: LotLandmark[] }) {
  const stripes = useMemo(() => roads.flatMap((road) => [...laneDashes(road.polygon!), ...edgeLines(road.polygon!)]), [roads]);
  // A unit stripe lying flat, scaled to each stripe. Built once, as in `Footprints`.
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    stripes.forEach(({ center, headingRad, lengthM, widthM }, index) => {
      instanceRotation.setFromAxisAngle(UP, headingRad);
      instanceMatrix.compose(new Vector3(...toWorld(center, HEIGHT.landmark + 0.003)), instanceRotation, new Vector3(lengthM, 1, widthM));
      mesh.current!.setMatrixAt(index, instanceMatrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [stripes, invalidate]);
  if (stripes.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, stripes.length]} key={stripes.length} receiveShadow>
      <meshLambertMaterial color={DETAIL.LANE_MARK} />
    </instancedMesh>
  );
}

/** A lane arrow lying flat, centred on the origin and pointing along world +x (metric +x). */
function arrowGeometry(): ShapeGeometry {
  const { lengthM, headM, headWidthM, stemWidthM } = ARROW;
  const [tail, neck, tip] = [-lengthM / 2, lengthM / 2 - headM, lengthM / 2];
  const shape = new Shape()
    .moveTo(tail, -stemWidthM / 2)
    .lineTo(neck, -stemWidthM / 2)
    .lineTo(neck, -headWidthM / 2)
    .lineTo(tip, 0)
    .lineTo(neck, headWidthM / 2)
    .lineTo(neck, stemWidthM / 2)
    .lineTo(tail, stemWidthM / 2)
    .closePath();
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Every road's lane arrows in one instanced draw. Self-contained, so the arrows can be dropped by removing its one use. */
function RoadArrows({ roads }: { roads: LotLandmark[] }) {
  const arrows = useMemo(() => roads.flatMap((road) => laneArrows(road.polygon!)), [roads]);
  const geometry = useMemo(arrowGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    arrows.forEach(({ center, headingRad }, index) => {
      instanceRotation.setFromAxisAngle(UP, headingRad);
      instanceMatrix.compose(new Vector3(...toWorld(center, HEIGHT.landmark + 0.004)), instanceRotation, UNIT_SCALE);
      mesh.current!.setMatrixAt(index, instanceMatrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [arrows, invalidate]);
  if (arrows.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, arrows.length]} key={arrows.length} receiveShadow>
      <meshLambertMaterial color={DETAIL.LANE_MARK} />
    </instancedMesh>
  );
}

/** Every tree as a trunk and a broad canopy, in two instanced draws. Each canopy is turned and shaded a little differently. */
function Trees({ trees }: { trees: LotLandmark[] }) {
  // A unit trunk standing on the ground, scaled to each tree. Built once, as in `Footprints`.
  const trunk = useMemo(() => new CylinderGeometry(0.14, 0.2, 1, 8).translate(0, 0.5, 0), []);
  useEffect(() => () => trunk.dispose(), [trunk]);
  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!trunks.current || !canopies.current) return;
    trees.forEach((tree, index) => {
      const height = tree.height_m!;
      const radius = tree.radius_m!;
      const crown = radius * 0.7;
      const [x, , z] = toWorld(tree.position);
      instanceRotation.identity();
      instanceMatrix.compose(new Vector3(x, 0, z), instanceRotation, new Vector3(1, height - crown, 1));
      trunks.current!.setMatrixAt(index, instanceMatrix);
      instanceRotation.setFromAxisAngle(UP, hash01(tree.landmark_id, 1) * Math.PI * 2);
      instanceMatrix.compose(new Vector3(x, height - crown, z), instanceRotation, new Vector3(radius, crown, radius));
      canopies.current!.setMatrixAt(index, instanceMatrix);
      canopies.current!.setColorAt(index, instanceColor.set(COLORS.TREE_CANOPY).offsetHSL(0, 0, (hash01(tree.landmark_id, 2) - 0.5) * 0.08));
    });
    for (const mesh of [trunks.current, canopies.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    canopies.current.instanceColor!.needsUpdate = true;
    invalidate();
  }, [trees, invalidate]);
  return (
    <>
      <instancedMesh ref={trunks} args={[trunk, undefined, trees.length]} key={`trunks-${trees.length}`} castShadow>
        <meshStandardMaterial color={COLORS.TREE_TRUNK} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, trees.length]} key={`canopies-${trees.length}`} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        {/* White, so each canopy shows its own instance colour. */}
        <meshStandardMaterial color="#ffffff" roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}

/** Steel posts holding up every shelter roof, along its edges, in one instanced draw. */
function ShelterPosts({ shelters }: { shelters: LotLandmark[] }) {
  // A unit post standing on the ground, scaled to each roof. Built once, as in `Footprints`.
  const post = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  useEffect(() => () => post.dispose(), [post]);
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const posts = useMemo(
    () => shelters.flatMap((shelter) => edgePoints(shelter.polygon!, SHELTER_POST_SPACING_M).map((point) => ({ point, height: shelter.height_m! - SHELTER_ROOF_M }))),
    [shelters],
  );
  useLayoutEffect(() => {
    if (!mesh.current) return;
    instanceRotation.identity();
    posts.forEach(({ point, height }, index) => {
      instanceMatrix.compose(new Vector3(...toWorld(point)), instanceRotation, new Vector3(SHELTER_POST_M, height, SHELTER_POST_M));
      mesh.current!.setMatrixAt(index, instanceMatrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [posts, invalidate]);
  return (
    <instancedMesh ref={mesh} args={[post, undefined, posts.length]} key={posts.length} castShadow receiveShadow>
      <meshLambertMaterial color={DETAIL.STEEL} />
    </instancedMesh>
  );
}

function Raised({ landmark, polygon, height, textures }: { landmark: LotLandmark; polygon: MetricPolygon; height: number; textures: DetailTextures }) {
  switch (landmark.kind) {
    case "BUILDING":
      return <Building landmark={landmark} polygon={polygon} height={height} textures={textures} />;
    case "GUARD_BOOTH":
      if (height >= BOOTH_TIERS.minHeightM) return <Booth landmark={landmark} polygon={polygon} height={height} textures={textures} />;
      break;
    case "PLANTING":
      return <Planter polygon={polygon} height={height} />;
    case "SHELTER":
      // A roof slab with a steel fascia; `ShelterPosts` holds it up.
      return <Prism polygon={polygon} base={height - SHELTER_ROOF_M} depth={SHELTER_ROOF_M} cap={landmarkTop(landmark)} wall={DETAIL.STEEL} />;
  }
  return <Prism polygon={polygon} base={0} depth={height} cap={landmarkTop(landmark)} wall={landmarkWall(landmark.kind)} />;
}

/** The pattern of a flat ground landmark: a road is the site's asphalt, the others their own colour. */
function groundPattern(kind: LotLandmark["kind"], textures: DetailTextures, asphalt: CanvasTexture): CanvasTexture | undefined {
  if (kind === "ROAD") return asphalt;
  if (kind === "WALKWAY") return textures.pavers;
  if (kind === "PLANTING") return textures.grass;
  return undefined;
}

function Landmark({ landmark, textures, asphalt }: { landmark: LotLandmark; textures: DetailTextures; asphalt: CanvasTexture }) {
  if (landmark.polygon && landmark.height_m) {
    return <Raised landmark={landmark} polygon={landmark.polygon} height={landmark.height_m} textures={textures} />;
  }
  if (landmark.polygon) {
    const map = groundPattern(landmark.kind, textures, asphalt);
    return (
      <>
        <Surface polygon={landmark.polygon} height={HEIGHT.landmark} color={map ? undefined : landmarkTop(landmark)} map={map} />
        {!GROUND_KINDS.has(landmark.kind) && <Outline polygon={landmark.polygon} height={HEIGHT.landmark} color="#ffffff" width={1.5} />}
      </>
    );
  }
  if (landmark.line) {
    return <Line points={landmark.line.map((point) => toWorld(point, HEIGHT.landmark))} color={COLORS.BARRIER} lineWidth={4} />;
  }
  if (landmark.kind === "ENTRANCE" || landmark.kind === "EXIT" || landmark.kind === "ENTRANCE_EXIT" || landmark.kind === "GUARD_BOOTH") {
    const color = landmark.kind === "EXIT" ? COLORS.EXIT : landmark.kind === "GUARD_BOOTH" ? COLORS.GUARD_BOOTH : COLORS.ENTRANCE;
    return (
      <mesh position={toWorld(landmark.position, HEIGHT.selection)} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.35, 24]} />
        <meshBasicMaterial color={color} />
      </mesh>
    );
  }
  return null;
}

function raisedOf(landmarks: LotLandmark[], kind: LotLandmark["kind"]): LotLandmark[] {
  return landmarks.filter((landmark) => landmark.kind === kind && landmark.polygon && landmark.height_m);
}

/**
 * Every landmark, with the instanced detail that several of them share drawn in one call each.
 * `asphalt` is the site's paving, shared with the lot, so a road reads as part of the same ground.
 */
export function Surroundings({ landmarks, asphalt }: { landmarks: LotLandmark[]; asphalt: CanvasTexture }) {
  const textures = useDetailTextures();
  const trees = useMemo(() => landmarks.filter((landmark) => landmark.kind === "TREE"), [landmarks]);
  const shelters = useMemo(() => raisedOf(landmarks, "SHELTER"), [landmarks]);
  const plantings = useMemo(() => raisedOf(landmarks, "PLANTING"), [landmarks]);
  const roads = useMemo(() => landmarks.filter((landmark) => landmark.kind === "ROAD" && landmark.polygon && !landmark.height_m), [landmarks]);
  return (
    <>
      {landmarks.map((landmark) => (
        <Landmark key={landmark.landmark_id} landmark={landmark} textures={textures} asphalt={asphalt} />
      ))}
      {trees.length > 0 && <Trees trees={trees} />}
      {shelters.length > 0 && <ShelterPosts shelters={shelters} />}
      {plantings.length > 0 && <Shrubs plantings={plantings} />}
      {roads.length > 0 && <RoadMarks roads={roads} />}
      {roads.length > 0 && <RoadArrows roads={roads} />}
    </>
  );
}
