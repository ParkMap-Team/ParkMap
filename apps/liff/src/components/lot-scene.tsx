"use client";

import { Line, MapControls, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  Color,
  type DirectionalLight,
  type ExtrudeGeometryOptions,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  PCFShadowMap,
  Path,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { LotLandmark, MetricPoint, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import {
  FOV_DEG,
  MAX_ELEVATION_RAD,
  MAX_ZOOM,
  MIN_ELEVATION_RAD,
  MIN_ZOOM,
  type View3D,
  cameraPosition,
  clampToBounds,
  overview3D,
  pan3D,
  viewFrom,
} from "@/lib/map/camera";
import { axisHeading, boundsCenter, boundsOf, edgePoints, fromWorld, toWorld } from "@/lib/map/geometry";
import { FACADES, type Facade, GROUND_KINDS, landmarkTop, landmarkWall } from "@/lib/map/landmark-style";
import { type LotMap, landmarkPoints } from "@/lib/map/lot-map";
import { MOTORCYCLE_MODEL, motorcycleTransform } from "@/lib/map/motorcycle-model";
import { COLORS } from "@/lib/parking/presentation";
import { LabelLayer, type LabelLayerHandle, MAP_INSETS, type MapViewHandle, type MapViewProps } from "./map-overlay";

// The 3D view: lot geometry and its static surroundings from the lot model, the API's regions on
// top, and one generic motorcycle per detected proxy. People pan, zoom, turn, and tilt the camera
// (ADR 0012). The surroundings cast one fixed sun's shadows, drawn once when they change; rendering
// is on demand, so a still map costs nothing.

// Layer heights keep coplanar surfaces from flickering.
const HEIGHT = { ground: -0.02, lot: 0, unmonitored: 0.01, area: 0.02, landmark: 0.025, region: 0.03, footprint: 0.04, selection: 0.06 };
// Status layers draw after everything else and skip the depth test, in this order, so no tree,
// hedge, or block in front of the lot can hide or tint a status. Motorcycles keep the depth test.
const STATUS_ORDER = { area: 1, areaStroke: 2, region: 3, regionStroke: 4, footprint: 5, motorcycle: 6, selection: 7 };
const PATTERN_TILE_M = 0.8;
const STOREY_M = 3.6;
const SHELTER_ROOF_M = 0.2;
const SHELTER_POST_M = 0.15;
const SHELTER_POST_SPACING_M = 5;
// Lambert light on an up-facing surface is (sky + sun * cos) / PI times its colour. These make sunlit
// ground its own colour and shaded ground about two thirds of it.
const SUN = new Vector3(-14, 30, 18).normalize();
const SUN_INTENSITY = 1.45;
const SKY_INTENSITY = 2;
const SHADOW_MAP_PX = 2048;
// The surroundings never move, so their shadows are drawn once, not every frame.
const SHADOWS = { type: PCFShadowMap, autoUpdate: false };
const TAP_SLOP_PX = 8;
const MAX_DPR = 1.75;

function toShape([outer, ...holes]: MetricPolygon): Shape {
  const shape = new Shape(outer.map((point) => new Vector2(point.x_m, point.y_m)));
  shape.holes = holes.map((ring) => new Path(ring.map((point) => new Vector2(point.x_m, point.y_m))));
  return shape;
}

/** A repeating pattern, in metres: shape and extruded wall UVs are the metric coordinates themselves. */
function pattern(background: string, draw: (context: CanvasRenderingContext2D) => void, tileM = PATTERN_TILE_M, px = 32): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const context = canvas.getContext("2d")!;
  context.fillStyle = background;
  context.fillRect(0, 0, px, px);
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / tileM, 1 / tileM);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Unknown ground is hatched. */
function hatch(): CanvasTexture {
  return pattern(COLORS.UNKNOWN, (context) => {
    context.strokeStyle = COLORS.UNKNOWN_HATCH;
    context.lineWidth = 6;
    for (const offset of [-32, 0, 32]) {
      context.beginPath();
      context.moveTo(offset, 32);
      context.lineTo(offset + 32, 0);
      context.stroke();
    }
  });
}

/** Unmonitored ground is asphalt grey with faint dots, so it recedes behind the monitored area. */
function dots(): CanvasTexture {
  return pattern(COLORS.UNMONITORED, (context) => {
    context.fillStyle = COLORS.UNMONITORED_DOT;
    context.beginPath();
    context.arc(16, 16, 4, 0, Math.PI * 2);
    context.fill();
  });
}

/** One storey of a facade, 3.6 m square; the canvas bottom is the floor. */
const FACADE_DRAW: Record<Facade, (context: CanvasRenderingContext2D, window: string, wall: string) => void> = {
  // Two windows on every storey.
  PLAIN(context, window) {
    context.fillStyle = window;
    for (const x of [3, 35]) context.fillRect(x, 22, 26, 28);
  },
  // An unbroken window band on every storey, split by thin mullions.
  WINDOW_BANDS(context, window, wall) {
    context.fillStyle = window;
    context.fillRect(0, 20, 64, 30);
    context.fillStyle = wall;
    for (const x of [0, 32]) context.fillRect(x, 20, 2, 30);
  },
  // A brick pier, then glass from slab to slab with one mullion.
  BRICK_AND_GLASS(context, window, wall) {
    context.fillStyle = window;
    context.fillRect(14, 6, 50, 52);
    context.fillStyle = wall;
    context.fillRect(38, 6, 2, 52);
  },
};

function facade(kind: Facade): CanvasTexture {
  const { wall, window } = FACADES[kind];
  return pattern(wall, (context) => FACADE_DRAW[kind](context, window, wall), STOREY_M, 64);
}

function usePatterns() {
  const patterns = useMemo(
    () => ({
      hatch: hatch(),
      dots: dots(),
      facades: { PLAIN: facade("PLAIN"), WINDOW_BANDS: facade("WINDOW_BANDS"), BRICK_AND_GLASS: facade("BRICK_AND_GLASS") } satisfies Record<Facade, CanvasTexture>,
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const texture of [patterns.hatch, patterns.dots, ...Object.values(patterns.facades)]) texture.dispose();
    },
    [patterns],
  );
  return patterns;
}

/**
 * `statusOrder` marks a status layer: unlit, and drawn in that order after the scene without a depth
 * test, so no shadow or block tints it. Every other surface is lit and takes the surroundings' shadows.
 */
function Surface({ polygon, height, color, map, statusOrder }: { polygon: MetricPolygon; height: number; color?: string; map?: CanvasTexture; statusOrder?: number }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  const status = statusOrder !== undefined;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} renderOrder={statusOrder ?? 0} receiveShadow={!status}>
      <shapeGeometry args={[shape]} />
      {/* A new material when the pattern comes or goes: three does not recompile a shader for a changed map. */}
      {status ? (
        <meshBasicMaterial key={map?.uuid ?? "plain"} color={map ? "#ffffff" : color} map={map} depthTest={false} />
      ) : (
        <meshLambertMaterial key={map?.uuid ?? "plain"} color={map ? "#ffffff" : color} map={map} />
      )}
    </mesh>
  );
}

function Outline({
  polygon,
  height,
  color,
  width,
  dashed = false,
  statusOrder,
}: {
  polygon: MetricPolygon;
  height: number;
  color: string;
  width: number;
  dashed?: boolean;
  statusOrder?: number;
}) {
  const points = useMemo(() => polygon[0].concat(polygon[0][0]).map((point) => toWorld(point, height)), [polygon, height]);
  return (
    <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.3} gapSize={0.2} renderOrder={statusOrder ?? 0} depthTest={statusOrder === undefined} />
  );
}

const footprintMatrix = new Matrix4();
const footprintRotation = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** Red footprints under every motorcycle, one instanced draw. */
function Footprints({ proxies }: { proxies: MotorcycleProxy[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    proxies.forEach((proxy, index) => {
      footprintRotation.setFromAxisAngle(UP, axisHeading(proxy.heading_rad));
      footprintMatrix.compose(new Vector3(...toWorld(proxy.center, HEIGHT.footprint)), footprintRotation, new Vector3(proxy.length_m, 1, proxy.width_m));
      mesh.current!.setMatrixAt(index, footprintMatrix);
    });
    mesh.current.count = proxies.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [proxies, invalidate]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, capacity(proxies.length)]} key={capacity(proxies.length)} renderOrder={STATUS_ORDER.footprint}>
      <planeGeometry args={[1, 1]} onUpdate={(geometry) => geometry.rotateX(-Math.PI / 2)} />
      {/* Opaque, so it stays in the same draw list as the motorcycles drawn over it. */}
      <meshBasicMaterial color={COLORS.OCCUPIED} depthTest={false} />
    </instancedMesh>
  );
}

/** Room for a few more instances, so a new detection rarely recreates the mesh. */
function capacity(count: number): number {
  return Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(count, 1))));
}

/** The generic model on every proxy, sharing one geometry in one instanced draw. */
function Motorcycles({ proxies, onReady }: { proxies: MotorcycleProxy[]; onReady(): void }) {
  // No Draco or Meshopt: the model is plain glTF from this app's own origin.
  const { scene } = useGLTF(MOTORCYCLE_MODEL.url, false, false);
  const geometry = useMemo(() => (scene.getObjectByName("motorcycle") as Mesh).geometry, [scene]);
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    proxies.forEach((proxy, index) => {
      const transform = motorcycleTransform(proxy);
      rotation.setFromAxisAngle(UP, transform.rotationY);
      matrix.compose(new Vector3(...transform.position), rotation, new Vector3(...transform.scale));
      mesh.current!.setMatrixAt(index, matrix);
    });
    mesh.current.count = proxies.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [proxies, invalidate]);
  useEffect(onReady, [onReady]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, capacity(proxies.length)]} key={capacity(proxies.length)} renderOrder={STATUS_ORDER.motorcycle}>
      <meshStandardMaterial vertexColors roughness={0.8} metalness={0} />
    </instancedMesh>
  );
}

/** A raised footprint: a building, booth, hedge, or planter as a block, or a shelter as a roof slab. */
function Block({ landmark, polygon, height, facades }: { landmark: LotLandmark; polygon: MetricPolygon; height: number; facades: Record<Facade, CanvasTexture> }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  const roof = landmark.kind === "SHELTER";
  const options = useMemo((): ExtrudeGeometryOptions => ({ depth: roof ? SHELTER_ROOF_M : height, bevelEnabled: false }), [roof, height]);
  return (
    // The shape is extruded along local +z, which this rotation turns to world up.
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof ? height - SHELTER_ROOF_M : 0, 0]} castShadow receiveShadow>
      <extrudeGeometry args={[shape, options]} />
      <meshStandardMaterial attach="material-0" color={landmarkTop(landmark)} roughness={0.9} />
      {landmark.kind === "BUILDING" ? (
        <meshStandardMaterial attach="material-1" map={facades[landmark.facade ?? "PLAIN"]} roughness={0.8} />
      ) : (
        <meshStandardMaterial attach="material-1" color={landmarkWall(landmark.kind)} roughness={0.9} />
      )}
    </mesh>
  );
}

const treeMatrix = new Matrix4();
const treeRotation = new Quaternion();
const canopyColor = new Color();

/** A stable number in [0, 1) for a landmark, so the same tree always looks the same. */
function hash01(text: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0) / 2 ** 32;
}

/** Every tree as a trunk and a broad canopy, in two instanced draws. Each canopy is turned and shaded a little differently. */
function Trees({ trees }: { trees: LotLandmark[] }) {
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
      treeRotation.identity();
      treeMatrix.compose(new Vector3(x, 0, z), treeRotation, new Vector3(1, height - crown, 1));
      trunks.current!.setMatrixAt(index, treeMatrix);
      treeRotation.setFromAxisAngle(UP, hash01(tree.landmark_id, 1) * Math.PI * 2);
      treeMatrix.compose(new Vector3(x, height - crown, z), treeRotation, new Vector3(radius, crown, radius));
      canopies.current!.setMatrixAt(index, treeMatrix);
      canopies.current!.setColorAt(index, canopyColor.set(COLORS.TREE_CANOPY).offsetHSL(0, 0, (hash01(tree.landmark_id, 2) - 0.5) * 0.08));
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
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} key={`trunks-${trees.length}`} castShadow>
        {/* A unit trunk standing on the ground, scaled to each tree. */}
        <cylinderGeometry args={[0.14, 0.2, 1, 8]} onUpdate={(geometry) => geometry.translate(0, 0.5, 0)} />
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

const postMatrix = new Matrix4();
const postRotation = new Quaternion();

/** Posts holding up every shelter roof, along its edges, in one instanced draw. */
function ShelterPosts({ shelters }: { shelters: LotLandmark[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const posts = useMemo(
    () => shelters.flatMap((shelter) => edgePoints(shelter.polygon!, SHELTER_POST_SPACING_M).map((point) => ({ point, height: shelter.height_m! - SHELTER_ROOF_M }))),
    [shelters],
  );
  useLayoutEffect(() => {
    if (!mesh.current) return;
    posts.forEach(({ point, height }, index) => {
      postMatrix.compose(new Vector3(...toWorld(point)), postRotation, new Vector3(SHELTER_POST_M, height, SHELTER_POST_M));
      mesh.current!.setMatrixAt(index, postMatrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [posts, invalidate]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, posts.length]} key={posts.length} castShadow>
      {/* A unit post standing on the ground, scaled to each roof. */}
      <boxGeometry args={[1, 1, 1]} onUpdate={(geometry) => geometry.translate(0, 0.5, 0)} />
      <meshStandardMaterial color={landmarkWall("SHELTER")} roughness={0.9} />
    </instancedMesh>
  );
}

/** One sun over the whole scene. Its shadow camera covers every landmark, and the shadows redraw only when they change. */
function Sun({ landmarks, outline }: { landmarks: LotLandmark[]; outline: MetricPolygon }) {
  const light = useRef<DirectionalLight>(null);
  const { gl, invalidate } = useThree();
  useLayoutEffect(() => {
    const sun = light.current;
    if (!sun) return;
    const extent = boundsOf([...outline[0], ...landmarks.flatMap(landmarkPoints)]);
    const tallest = Math.max(0, ...landmarks.map((landmark) => landmark.height_m ?? 0));
    const margin = Math.max(0, ...landmarks.map((landmark) => landmark.radius_m ?? 0));
    const radius = Math.hypot((extent.maxX - extent.minX) / 2 + margin, (extent.maxY - extent.minY) / 2 + margin, tallest);
    const [x, , z] = toWorld(boundsCenter(extent));
    sun.target.position.set(x, 0, z);
    sun.target.updateMatrixWorld();
    sun.position.set(x, 0, z).addScaledVector(SUN, 2 * radius);
    const camera = sun.shadow.camera;
    camera.left = camera.bottom = -radius;
    camera.right = camera.top = radius;
    camera.near = radius;
    camera.far = 3 * radius;
    camera.updateProjectionMatrix();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [landmarks, outline, gl, invalidate]);
  return (
    <directionalLight
      ref={light}
      intensity={SUN_INTENSITY}
      castShadow
      shadow-mapSize={[SHADOW_MAP_PX, SHADOW_MAP_PX]}
      shadow-bias={-0.0005}
      shadow-normalBias={0.05}
    />
  );
}

function Landmark({ landmark, facades }: { landmark: LotLandmark; facades: Record<Facade, CanvasTexture> }) {
  if (landmark.polygon && landmark.height_m) {
    return <Block landmark={landmark} polygon={landmark.polygon} height={landmark.height_m} facades={facades} />;
  }
  if (landmark.polygon) {
    return (
      <>
        <Surface polygon={landmark.polygon} height={HEIGHT.landmark} color={landmarkTop(landmark)} />
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

function Ground({ map, onSelect, onReady }: { map: LotMap; onSelect(point: MetricPoint | null): void; onReady(): void }) {
  const { hatch, dots, facades } = usePatterns();
  const proxies = useMemo(() => map.areas.flatMap((area) => area.motorcycles.map(({ proxy }) => proxy)), [map]);
  const trees = useMemo(() => map.landmarks.filter((landmark) => landmark.kind === "TREE"), [map.landmarks]);
  const shelters = useMemo(() => map.landmarks.filter((landmark) => landmark.kind === "SHELTER" && landmark.polygon && landmark.height_m), [map.landmarks]);
  const invalidate = useThree((state) => state.invalidate);
  // Demand rendering does not draw newly mounted meshes by itself, so new data asks for a frame.
  useEffect(() => invalidate(), [map, invalidate]);
  function onClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > TAP_SLOP_PX) return;
    onSelect(fromWorld(event.point.x, event.point.z));
  }
  return (
    <>
      {/* The ground plane takes taps anywhere; the tap is resolved against the map. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, HEIGHT.ground, 0]} onClick={onClick} receiveShadow>
        <planeGeometry args={[1000, 1000]} />
        <meshLambertMaterial color={COLORS.GROUND} />
      </mesh>
      <Surface polygon={map.outline} height={HEIGHT.lot} color={COLORS.LOT} />
      {map.unmonitored.map((polygon, index) => (
        <Surface key={index} polygon={polygon} height={HEIGHT.unmonitored} map={dots} />
      ))}
      {map.landmarks.map((landmark) => (
        <Landmark key={landmark.landmark_id} landmark={landmark} facades={facades} />
      ))}
      {trees.length > 0 && <Trees trees={trees} />}
      {shelters.length > 0 && <ShelterPosts shelters={shelters} />}
      {map.areas.map((area) => (
        <group key={area.parkingAreaId}>
          <Surface
            polygon={area.polygon}
            height={HEIGHT.area}
            color={area.unknownReason ? undefined : COLORS.PARKING_AREA}
            map={area.unknownReason ? hatch : undefined}
            statusOrder={STATUS_ORDER.area}
          />
          <Outline polygon={area.polygon} height={HEIGHT.area} color={COLORS.PARKING_AREA_STROKE} width={1} statusOrder={STATUS_ORDER.areaStroke} />
          {area.regions.map((region, index) => (
            <group key={index}>
              <Surface
                polygon={region.polygon}
                height={HEIGHT.region}
                color={region.kind === "UNKNOWN" ? undefined : COLORS[region.kind]}
                map={region.kind === "UNKNOWN" ? hatch : undefined}
                statusOrder={STATUS_ORDER.region}
              />
              {region.kind !== "UNKNOWN" && (
                <Outline
                  polygon={region.polygon}
                  height={HEIGHT.region}
                  color={region.kind === "AVAILABLE" ? COLORS.AVAILABLE_STROKE : COLORS.ALMOST_AVAILABLE_STROKE}
                  width={2}
                  dashed={region.kind === "ALMOST_AVAILABLE"}
                  statusOrder={STATUS_ORDER.regionStroke}
                />
              )}
            </group>
          ))}
        </group>
      ))}
      <Footprints proxies={proxies} />
      {/* The model loads behind Suspense; the rest of the map shows at once. */}
      <Suspense fallback={null}>
        <Motorcycles proxies={proxies} onReady={onReady} />
      </Suspense>
    </>
  );
}

function Selection({ polygon }: { polygon: MetricPolygon }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
    return () => invalidate();
  }, [polygon, invalidate]);
  return (
    <>
      <Outline polygon={polygon} height={HEIGHT.selection} color={COLORS.SELECTED_HALO} width={6} statusOrder={STATUS_ORDER.selection} />
      <Outline polygon={polygon} height={HEIGHT.selection + 0.005} color={COLORS.SELECTED} width={3} statusOrder={STATUS_ORDER.selection + 1} />
    </>
  );
}

/** Owns the camera: overview on mount and resize, zoom and tilt limits, pan kept over the lot, and labels. */
function CameraRig({ map, handle, labels }: { map: LotMap; handle: React.Ref<MapViewHandle>; labels: React.RefObject<LabelLayerHandle | null> }) {
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const { camera, size, invalidate } = useThree();
  const overview = useMemo(() => overview3D(map.bounds, { ...size, insets: MAP_INSETS }), [map.bounds, size]);
  const atOverview = useRef(true);
  const latestBounds = useRef(map.bounds);
  latestBounds.current = map.bounds;

  function current(): View3D {
    const target = controls.current!.target;
    return viewFrom([camera.position.x, camera.position.y, camera.position.z], fromWorld(target.x, target.z));
  }

  function apply(view: View3D) {
    if (!controls.current) return;
    const distance = Math.min(overview.distance / MIN_ZOOM, Math.max(overview.distance / MAX_ZOOM, view.distance));
    const elevationRad = Math.min(MAX_ELEVATION_RAD, Math.max(MIN_ELEVATION_RAD, view.elevationRad));
    const target = clampToBounds(view.target, map.bounds);
    camera.position.set(...cameraPosition({ ...view, target, distance, elevationRad }));
    controls.current.target.set(...toWorld(target));
    controls.current.update();
    invalidate();
  }

  // A resize, such as the panel opening, refits the overview. Once people have moved the view,
  // neither a resize nor new data moves it again.
  const refit = useRef(() => {});
  refit.current = () => {
    if (atOverview.current) apply(overview);
  };
  useLayoutEffect(() => refit.current(), [overview]);

  useImperativeHandle(handle, () => ({
    zoomBy(factor) {
      atOverview.current = false;
      const view = current();
      apply({ ...view, distance: view.distance / factor });
    },
    reset() {
      atOverview.current = true;
      apply(overview);
    },
    focus(point) {
      atOverview.current = false;
      const view = current();
      apply({ ...view, target: point, distance: Math.min(view.distance, overview.distance / 2) });
    },
    panBy(dx, dy) {
      atOverview.current = false;
      apply(pan3D(current(), dx, dy, size.height));
    },
    rotateBy(rad) {
      atOverview.current = false;
      // Moving the camera clockwise around the target turns the map counter-clockwise on screen.
      const view = current();
      apply({ ...view, azimuthRad: view.azimuthRad - rad });
    },
  }));

  // drei reconnects the controls whenever these handlers change, which drops a drag in progress,
  // so they stay stable across the page's clock ticks and polls.
  // Pan is kept over the lot: a target pushed past the bounds is pulled back with the camera.
  const onChange = useCallback(() => {
    const target = controls.current!.target;
    const clamped = clampToBounds(fromWorld(target.x, target.z), latestBounds.current);
    const [x, , z] = toWorld(clamped);
    if (x !== target.x || z !== target.z) {
      camera.position.x += x - target.x;
      camera.position.z += z - target.z;
      target.set(x, 0, z);
    }
  }, [camera]);
  const onStart = useCallback(() => {
    atOverview.current = false;
  }, []);

  const projected = useMemo(() => new Vector3(), []);
  useFrame(() => {
    labels.current?.update(
      (point) => {
        projected.set(...toWorld(point)).project(camera);
        if (projected.z > 1) return null;
        return [((projected.x + 1) / 2) * size.width, ((1 - projected.y) / 2) * size.height];
      },
      size,
      overview.distance / camera.position.distanceTo(controls.current?.target ?? projected.set(0, 0, 0)),
    );
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping={false}
      // Polar angles are measured from straight down.
      minPolarAngle={Math.PI / 2 - MAX_ELEVATION_RAD}
      maxPolarAngle={Math.PI / 2 - MIN_ELEVATION_RAD}
      screenSpacePanning={false}
      minDistance={overview.distance / MAX_ZOOM}
      maxDistance={overview.distance / MIN_ZOOM}
      onStart={onStart}
      onChange={onChange}
    />
  );
}

export default function LotScene({ map, labels, selection, onSelect, onReady, onError, ref }: MapViewProps & { onReady(): void; onError(): void }) {
  const labelLayer = useRef<LabelLayerHandle>(null);
  return (
    <div className="relative size-full" style={{ backgroundColor: COLORS.GROUND }}>
      <Canvas
        dpr={[1, MAX_DPR]}
        frameloop="demand"
        shadows={SHADOWS}
        camera={{ fov: FOV_DEG, near: 0.5, far: 2000 }}
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onError)}
      >
        <color attach="background" args={[COLORS.GROUND]} />
        {/* Soft sky light with one sun from the front left, so block walls and roofs read apart. */}
        <hemisphereLight args={["#ffffff", "#b8c2b0", SKY_INTENSITY]} />
        <Sun landmarks={map.landmarks} outline={map.outline} />
        <Ground map={map} onSelect={onSelect} onReady={onReady} />
        {selection?.polygon && <Selection polygon={selection.polygon} />}
        <CameraRig map={map} handle={ref ?? null} labels={labelLayer} />
      </Canvas>
      <LabelLayer ref={labelLayer} labels={labels} selection={selection} />
    </div>
  );
}

useGLTF.preload(MOTORCYCLE_MODEL.url, false, false);
