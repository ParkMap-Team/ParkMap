"use client";

import { Line, MapControls, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { CanvasTexture, type InstancedMesh, Matrix4, type Mesh, Path, Quaternion, RepeatWrapping, SRGBColorSpace, Shape, Vector2, Vector3 } from "three";
import type { LotLandmark, MetricPoint, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import { FOV_DEG, MAX_ZOOM, MIN_ZOOM, type View3D, cameraPosition, clampToBounds, overview3D } from "@/lib/map/camera";
import { axisHeading, fromWorld, toWorld } from "@/lib/map/geometry";
import type { LotMap } from "@/lib/map/lot-map";
import { MOTORCYCLE_MODEL, motorcycleTransform } from "@/lib/map/motorcycle-model";
import { COLORS } from "@/lib/parking/presentation";
import { LabelLayer, type LabelLayerHandle, MAP_INSETS, type MapViewHandle, type MapViewProps } from "./map-overlay";

// The 3D view: flat lot geometry from the lot model, the API's regions on top, and one generic
// motorcycle per detected proxy. The camera keeps a fixed elevated angle; people pan and zoom but
// never orbit (ADR 0008). Rendering is on demand, so a still map costs nothing.

// Layer heights keep coplanar surfaces from flickering.
const HEIGHT = { lot: 0, unmonitored: 0.01, area: 0.02, landmark: 0.025, region: 0.03, footprint: 0.04, selection: 0.06 };
const PATTERN_TILE_M = 0.8;
const TAP_SLOP_PX = 8;
const MAX_DPR = 1.75;

function toShape([outer, ...holes]: MetricPolygon): Shape {
  const shape = new Shape(outer.map((point) => new Vector2(point.x_m, point.y_m)));
  shape.holes = holes.map((ring) => new Path(ring.map((point) => new Vector2(point.x_m, point.y_m))));
  return shape;
}

/** A repeating pattern, in metres: shape geometry UVs are the metric coordinates themselves. */
function pattern(background: string, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = background;
  context.fillRect(0, 0, 32, 32);
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / PATTERN_TILE_M, 1 / PATTERN_TILE_M);
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

function usePatterns() {
  const patterns = useMemo(() => ({ hatch: hatch(), dots: dots() }), []);
  useEffect(
    () => () => {
      patterns.hatch.dispose();
      patterns.dots.dispose();
    },
    [patterns],
  );
  return patterns;
}

function Surface({ polygon, height, color, map, opacity = 1 }: { polygon: MetricPolygon; height: number; color?: string; map?: CanvasTexture; opacity?: number }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
      <shapeGeometry args={[shape]} />
      {/* A new material when the pattern comes or goes: three does not recompile a shader for a changed map. */}
      <meshBasicMaterial key={map?.uuid ?? "plain"} color={map ? "#ffffff" : color} map={map} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Outline({ polygon, height, color, width, dashed = false }: { polygon: MetricPolygon; height: number; color: string; width: number; dashed?: boolean }) {
  const points = useMemo(() => polygon[0].concat(polygon[0][0]).map((point) => toWorld(point, height)), [polygon, height]);
  return <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.3} gapSize={0.2} />;
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
    <instancedMesh ref={mesh} args={[undefined, undefined, capacity(proxies.length)]} key={capacity(proxies.length)}>
      <planeGeometry args={[1, 1]} onUpdate={(geometry) => geometry.rotateX(-Math.PI / 2)} />
      <meshBasicMaterial color={COLORS.OCCUPIED} transparent opacity={0.85} />
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
    <instancedMesh ref={mesh} args={[geometry, undefined, capacity(proxies.length)]} key={capacity(proxies.length)}>
      <meshStandardMaterial vertexColors roughness={0.8} metalness={0} />
    </instancedMesh>
  );
}

function Landmark({ landmark }: { landmark: LotLandmark }) {
  if (landmark.polygon) {
    const color = landmark.kind === "GUARD_BOOTH" ? COLORS.GUARD_BOOTH : landmark.kind === "AISLE" ? COLORS.AISLE : COLORS.BUILDING;
    return (
      <>
        <Surface polygon={landmark.polygon} height={HEIGHT.landmark} color={color} />
        <Outline polygon={landmark.polygon} height={HEIGHT.landmark} color="#ffffff" width={1.5} />
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
  const { hatch, dots } = usePatterns();
  const proxies = useMemo(() => map.areas.flatMap((area) => area.motorcycles.map(({ proxy }) => proxy)), [map]);
  const invalidate = useThree((state) => state.invalidate);
  // Demand rendering does not draw newly mounted meshes by itself, so new data asks for a frame.
  useEffect(() => invalidate(), [map, invalidate]);
  function onClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > TAP_SLOP_PX) return;
    onSelect(fromWorld(event.point.x, event.point.z));
  }
  return (
    <>
      {/* An invisible plane takes taps anywhere on the ground; the tap is resolved against the map. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Surface polygon={map.outline} height={HEIGHT.lot} color={COLORS.LOT} />
      {map.unmonitored.map((polygon, index) => (
        <Surface key={index} polygon={polygon} height={HEIGHT.unmonitored} map={dots} />
      ))}
      {map.landmarks.map((landmark) => (
        <Landmark key={landmark.landmark_id} landmark={landmark} />
      ))}
      {map.areas.map((area) => (
        <group key={area.parkingAreaId}>
          <Surface polygon={area.polygon} height={HEIGHT.area} color={area.unknownReason ? undefined : COLORS.PARKING_AREA} map={area.unknownReason ? hatch : undefined} />
          <Outline polygon={area.polygon} height={HEIGHT.area} color={COLORS.PARKING_AREA_STROKE} width={1} />
          {area.regions.map((region, index) => (
            <group key={index}>
              <Surface polygon={region.polygon} height={HEIGHT.region} color={region.kind === "UNKNOWN" ? undefined : COLORS[region.kind]} map={region.kind === "UNKNOWN" ? hatch : undefined} />
              {region.kind !== "UNKNOWN" && (
                <Outline
                  polygon={region.polygon}
                  height={HEIGHT.region}
                  color={region.kind === "AVAILABLE" ? COLORS.AVAILABLE_STROKE : COLORS.ALMOST_AVAILABLE_STROKE}
                  width={2}
                  dashed={region.kind === "ALMOST_AVAILABLE"}
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
      <Outline polygon={polygon} height={HEIGHT.selection} color={COLORS.SELECTED_HALO} width={6} />
      <Outline polygon={polygon} height={HEIGHT.selection + 0.005} color={COLORS.SELECTED} width={3} />
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
    <div className="relative size-full" style={{ backgroundColor: "#f8fafc" }}>
      <Canvas
        dpr={[1, MAX_DPR]}
        frameloop="demand"
        camera={{ fov: FOV_DEG, near: 0.5, far: 2000 }}
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onError)}
      >
        <color attach="background" args={["#f8fafc"]} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[8, 20, 12]} intensity={1.6} />
        <Ground map={map} onSelect={onSelect} onReady={onReady} />
        {selection?.polygon && <Selection polygon={selection.polygon} />}
        <CameraRig map={map} handle={ref ?? null} labels={labelLayer} />
      </Canvas>
      <LabelLayer ref={labelLayer} labels={labels} selection={selection} />
    </div>
  );
}

useGLTF.preload(MOTORCYCLE_MODEL.url, false, false);
