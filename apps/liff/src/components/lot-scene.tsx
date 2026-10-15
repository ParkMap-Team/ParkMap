"use client";

import { Line, MapControls, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { CanvasTexture, type ExtrudeGeometryOptions, type InstancedMesh, Matrix4, type Mesh, Path, Quaternion, RepeatWrapping, SRGBColorSpace, Shape, Vector2, Vector3 } from "three";
import type { LotLandmark, MetricPoint, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import { FOV_DEG, MAX_ZOOM, MIN_ZOOM, type View3D, cameraPosition, clampToBounds, overview3D } from "@/lib/map/camera";
import { axisHeading, fromWorld, toWorld } from "@/lib/map/geometry";
import { GROUND_KINDS, landmarkTop, landmarkWall } from "@/lib/map/landmark-style";
import type { LotMap } from "@/lib/map/lot-map";
import { MOTORCYCLE_MODEL, motorcycleTransform } from "@/lib/map/motorcycle-model";
import { COLORS } from "@/lib/parking/presentation";
import { LabelLayer, type LabelLayerHandle, MAP_INSETS, type MapViewHandle, type MapViewProps } from "./map-overlay";

// The 3D view: lot geometry and its static surroundings from the lot model, the API's regions on
// top, and one generic motorcycle per detected proxy. The camera keeps a fixed elevated angle;
// people pan and zoom but never orbit (ADR 0008). Rendering is on demand, so a still map costs nothing.

// Layer heights keep coplanar surfaces from flickering.
const HEIGHT = { ground: -0.02, lot: 0, unmonitored: 0.01, area: 0.02, landmark: 0.025, region: 0.03, footprint: 0.04, selection: 0.06 };
// Status layers draw after everything else and skip the depth test, in this order, so no tree,
// hedge, or block in front of the lot can hide or tint a status. Motorcycles keep the depth test.
const STATUS_ORDER = { area: 1, areaStroke: 2, region: 3, regionStroke: 4, footprint: 5, motorcycle: 6, selection: 7 };
const PATTERN_TILE_M = 0.8;
const STOREY_M = 3.6;
const SHELTER_ROOF_M = 0.2;
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

/** Unmonitored ground is dark with dots. */
function dots(): CanvasTexture {
  return pattern(COLORS.UNMONITORED, (context) => {
    context.fillStyle = COLORS.UNMONITORED_DOT;
    context.beginPath();
    context.arc(16, 16, 4, 0, Math.PI * 2);
    context.fill();
  });
}

/** Facade walls: a band of windows on every storey. */
function facade(): CanvasTexture {
  return pattern(
    COLORS.FACADE,
    (context) => {
      context.fillStyle = COLORS.FACADE_WINDOW;
      for (const x of [3, 35]) context.fillRect(x, 22, 26, 28);
    },
    STOREY_M,
    64,
  );
}

function usePatterns() {
  const patterns = useMemo(() => ({ hatch: hatch(), dots: dots(), facade: facade() }), []);
  useEffect(
    () => () => {
      patterns.hatch.dispose();
      patterns.dots.dispose();
      patterns.facade.dispose();
    },
    [patterns],
  );
  return patterns;
}

/** `statusOrder` marks a status layer: drawn in that order after the scene, without a depth test. */
function Surface({ polygon, height, color, map, statusOrder }: { polygon: MetricPolygon; height: number; color?: string; map?: CanvasTexture; statusOrder?: number }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} renderOrder={statusOrder ?? 0}>
      <shapeGeometry args={[shape]} />
      {/* A new material when the pattern comes or goes: three does not recompile a shader for a changed map. */}
      <meshBasicMaterial key={map?.uuid ?? "plain"} color={map ? "#ffffff" : color} map={map} depthTest={statusOrder === undefined} />
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
function Block({ landmark, polygon, height, facade }: { landmark: LotLandmark; polygon: MetricPolygon; height: number; facade: CanvasTexture }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  const roof = landmark.kind === "SHELTER";
  const options = useMemo((): ExtrudeGeometryOptions => ({ depth: roof ? SHELTER_ROOF_M : height, bevelEnabled: false }), [roof, height]);
  return (
    // The shape is extruded along local +z, which this rotation turns to world up.
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof ? height - SHELTER_ROOF_M : 0, 0]}>
      <extrudeGeometry args={[shape, options]} />
      <meshStandardMaterial attach="material-0" color={landmarkTop(landmark)} roughness={0.9} />
      {landmark.kind === "BUILDING" ? (
        <meshStandardMaterial attach="material-1" map={facade} roughness={0.8} />
      ) : (
        <meshStandardMaterial attach="material-1" color={landmarkWall(landmark.kind)} roughness={0.9} />
      )}
    </mesh>
  );
}

const treeMatrix = new Matrix4();
const treeRotation = new Quaternion();

/** Every tree as a trunk and a round canopy, in two instanced draws. */
function Trees({ trees }: { trees: LotLandmark[] }) {
  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!trunks.current || !canopies.current) return;
    trees.forEach((tree, index) => {
      const height = tree.height_m!;
      const radius = tree.radius_m!;
      const [x, , z] = toWorld(tree.position);
      treeMatrix.compose(new Vector3(x, 0, z), treeRotation, new Vector3(1, height - radius, 1));
      trunks.current!.setMatrixAt(index, treeMatrix);
      treeMatrix.compose(new Vector3(x, height - radius * 0.9, z), treeRotation, new Vector3(radius, radius * 0.9, radius));
      canopies.current!.setMatrixAt(index, treeMatrix);
    });
    for (const mesh of [trunks.current, canopies.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    invalidate();
  }, [trees, invalidate]);
  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} key={`trunks-${trees.length}`}>
        {/* A unit trunk standing on the ground, scaled to each tree. */}
        <cylinderGeometry args={[0.14, 0.2, 1, 8]} onUpdate={(geometry) => geometry.translate(0, 0.5, 0)} />
        <meshStandardMaterial color={COLORS.TREE_TRUNK} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, trees.length]} key={`canopies-${trees.length}`}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={COLORS.TREE_CANOPY} roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}

function Landmark({ landmark, facade }: { landmark: LotLandmark; facade: CanvasTexture }) {
  if (landmark.polygon && landmark.height_m) {
    return <Block landmark={landmark} polygon={landmark.polygon} height={landmark.height_m} facade={facade} />;
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
  const { hatch, dots, facade } = usePatterns();
  const proxies = useMemo(() => map.areas.flatMap((area) => area.motorcycles.map(({ proxy }) => proxy)), [map]);
  const trees = useMemo(() => map.landmarks.filter((landmark) => landmark.kind === "TREE"), [map.landmarks]);
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, HEIGHT.ground, 0]} onClick={onClick}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial color={COLORS.GROUND} />
      </mesh>
      <Surface polygon={map.outline} height={HEIGHT.lot} color={COLORS.LOT} />
      {map.unmonitored.map((polygon, index) => (
        <Surface key={index} polygon={polygon} height={HEIGHT.unmonitored} map={dots} />
      ))}
      {map.landmarks.map((landmark) => (
        <Landmark key={landmark.landmark_id} landmark={landmark} facade={facade} />
      ))}
      {trees.length > 0 && <Trees trees={trees} />}
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

/** Owns the camera: overview on mount and resize, zoom limits, pan kept over the lot, and labels. */
function CameraRig({ map, handle, labels }: { map: LotMap; handle: React.Ref<MapViewHandle>; labels: React.RefObject<LabelLayerHandle | null> }) {
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const { camera, size, invalidate } = useThree();
  const overview = useMemo(() => overview3D(map.bounds, { ...size, insets: MAP_INSETS }), [map.bounds, size]);
  const atOverview = useRef(true);
  const latestBounds = useRef(map.bounds);
  latestBounds.current = map.bounds;

  function current(): View3D {
    const target = controls.current!.target;
    return { target: fromWorld(target.x, target.z), distance: camera.position.distanceTo(target) };
  }

  function apply(view: View3D) {
    if (!controls.current) return;
    const distance = Math.min(overview.distance / MIN_ZOOM, Math.max(overview.distance / MAX_ZOOM, view.distance));
    const target = clampToBounds(view.target, map.bounds);
    camera.position.set(...cameraPosition({ target, distance }));
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
      apply({ target: point, distance: Math.min(current().distance, overview.distance / 2) });
    },
    panBy(dx, dy) {
      atOverview.current = false;
      const view = current();
      const metresPerPixel = (2 * view.distance * Math.tan((FOV_DEG * Math.PI) / 360)) / size.height;
      apply({ ...view, target: { x_m: view.target.x_m - dx * metresPerPixel, y_m: view.target.y_m + dy * metresPerPixel } });
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
      enableRotate={false}
      enableDamping={false}
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
        camera={{ fov: FOV_DEG, near: 0.5, far: 2000 }}
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onError)}
      >
        <color attach="background" args={[COLORS.GROUND]} />
        {/* Soft sky light with one sun from the front left, so block walls and roofs read apart. */}
        <hemisphereLight args={["#ffffff", "#b8c2b0", 1.3]} />
        <directionalLight position={[-14, 30, 18]} intensity={1.7} />
        <Ground map={map} onSelect={onSelect} onReady={onReady} />
        {selection?.polygon && <Selection polygon={selection.polygon} />}
        <CameraRig map={map} handle={ref ?? null} labels={labelLayer} />
      </Canvas>
      <LabelLayer ref={labelLayer} labels={labels} selection={selection} />
    </div>
  );
}

useGLTF.preload(MOTORCYCLE_MODEL.url, false, false);
