"use client";

import { MapControls, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Color,
  CustomBlending,
  type DirectionalLight,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  Object3D,
  OneFactor,
  PCFShadowMap,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  ZeroFactor,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { MetricPoint, MetricPolygon, MotorcycleProxy } from "@/lib/api/types";
import {
  FLY_MS,
  FOV_DEG,
  INTRO_MS,
  MAX_ELEVATION_RAD,
  MAX_ZOOM,
  MIN_ELEVATION_RAD,
  MIN_ZOOM,
  NUDGE_MS,
  type View3D,
  cameraPosition,
  clampToBounds,
  easeInOut,
  easeOut,
  introView3D,
  mix3D,
  overview3D,
  pan3D,
  revealOffset,
  viewFrom,
} from "@/lib/map/camera";
import { type Flight, fly } from "@/lib/map/flight";
import { axisHeading, fromWorld, toWorld } from "@/lib/map/geometry";
import { DETAIL } from "@/lib/map/landmark-style";
import { type LotMap } from "@/lib/map/lot-map";
import { MOTORCYCLE_MODEL, motorcyclePaint, motorcycleTransform } from "@/lib/map/motorcycle-model";
import { COLORS } from "@/lib/parking/presentation";
import { cn } from "@/lib/utils";
import { Surroundings } from "./lot-surroundings";
import { LabelLayer, type LabelLayerHandle, type MapViewHandle, type MapViewProps } from "./map-overlay";
import { HEIGHT, Outline, Surface, asphalt, pattern } from "./scene-primitives";

// The 3D view: lot geometry and its static surroundings from the lot model, the API's regions on
// top, and one generic motorcycle per detected proxy. People pan, zoom, turn, and tilt the camera
// (ADR 0012). It is an architectural model, not a reconstruction: surroundings carry generic,
// flat-coloured detail on their recorded footprints and heights (see `lot-surroundings`), on
// asphalt that paves the site's extent, the lot wherever no status covers it, and the roads, under
// a soft sky and one fixed light that suggests no time of day. The light comes from the side of the
// opening view, so the soft shadows it casts of buildings, shrubs, trees, and motorcycles fall
// across the view rather than behind what casts them. Shadows land on the ground and landmarks
// only; status layers never receive one, so a shadow never tints a status. Rendering is on demand, so a still map costs
// nothing, and the shadow map is redrawn only when something that casts a shadow changes, never for
// a camera move.

// Status layers draw after everything else and skip the depth test, in this order, so no tree,
// hedge, or block in front of the lot can hide or tint a status. Motorcycles keep the depth test.
// Region edges draw before region surfaces: the API sends a region as many narrow cells, and the
// surfaces cover the inner half of every edge, so only the outside of a run of cells keeps one and
// the map draws no stall lines.
const STATUS_ORDER = { area: 1, areaStroke: 2, regionStroke: 3, region: 4, footprint: 5, motorcycle: 6, selection: 7 };
// Lambert light on an up-facing surface is (sky + light * cos) / PI times its colour. These make
// ground its own colour, give the light enough of that share for a shadow to read, and turn walls
// facing away from it darker than roofs so blocks read as blocks.
// A status is paint on the lot's asphalt, not a sticker over it: its colour takes this share of the
// asphalt's, keeping its hue, and the asphalt's grain shows through it.
const PAINT_ASPHALT_SHARE = 0.3;

function statusPaint(color: string): string {
  return `#${new Color(color).lerp(new Color(DETAIL.ASPHALT), PAINT_ASPHALT_SHARE).getHexString()}`;
}

const LIGHT_DIRECTION = new Vector3(-28, 34, 6).normalize();
const LIGHT_INTENSITY = 2;
const SKY_INTENSITY = 1.55;
const SKY_COLOR = "#f3f7ff";
const BOUNCE_COLOR = "#c6bdab";
const LIGHT_COLOR = "#fff6e9";
// How much of the light a shadow takes away: enough to ground a block or a motorcycle, never black.
const SHADOW_INTENSITY = 0.65;
const SHADOW_MAP_PX = 2048;
// The light never moves, so the shadow map is drawn on request rather than every frame.
const SHADOWS = { enabled: true, type: PCFShadowMap, autoUpdate: false };
// A motorcycle token: a low rounded block on the footprint, which reads at overview scale where the
// model's shape does not.
const TOKEN_HEIGHT_M = 0.4;
const TOKEN_RADIUS_M = 0.18;
// The occupied glow spans this much of the footprint, so it shows around the model's sides, and is
// this opaque at its centre.
const GLOW_SCALE = { length: 1.35, width: 2 };
const GLOW_ALPHA = 0.8;
const TAP_SLOP_PX = 8;
const MAX_DPR = 1.75;

/** Unknown ground is hatched. */
function hatch(): CanvasTexture {
  return pattern(COLORS.UNKNOWN, (context) => {
    context.strokeStyle = COLORS.UNKNOWN_HATCH;
    context.lineWidth = 4;
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

// Asphalt is mostly seen at a slant; this keeps its grain from smearing.
const MAX_ANISOTROPY = 8;

function usePatterns() {
  const gl = useThree((state) => state.gl);
  const patterns = useMemo(() => {
    const paving = asphalt(DETAIL.ASPHALT);
    paving.anisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy());
    // The asphalt's grain on white: a status colour tinted by it reads as paint on the same paving.
    const paint = asphalt("#ffffff");
    paint.anisotropy = paving.anisotropy;
    return { hatch: hatch(), dots: dots(), asphalt: paving, paint };
  }, [gl]);
  useEffect(() => () => Object.values(patterns).forEach((texture) => texture.dispose()), [patterns]);
  return patterns;
}

/** Asks for a frame with a fresh shadow map, for when something that casts a shadow has changed. */
function useRedraw(): () => void {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  return useCallback(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, invalidate]);
}

const footprintMatrix = new Matrix4();
const footprintRotation = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** A soft occupied-red ellipse that fades out at its edge, on a square texture stretched per footprint. */
function glow(): CanvasTexture {
  const px = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const context = canvas.getContext("2d")!;
  const red = Number.parseInt(COLORS.OCCUPIED.slice(1), 16);
  const rgba = (alpha: number) => `rgba(${(red >> 16) & 255}, ${(red >> 8) & 255}, ${red & 255}, ${alpha})`;
  const gradient = context.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  gradient.addColorStop(0, rgba(GLOW_ALPHA));
  gradient.addColorStop(0.55, rgba(GLOW_ALPHA));
  gradient.addColorStop(1, rgba(0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, px, px);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A soft red glow under every motorcycle, one instanced draw. It reaches past the footprint, so the
 * occupied colour shows around a token or a painted model from any angle, and it has no hard edge,
 * so motorcycles that the API places a little out of line do not look like misaligned boxes.
 */
function Footprints({ proxies }: { proxies: MotorcycleProxy[] }) {
  // Built once: R3F re-runs `onUpdate` when a suspense boundary hides and shows the tree, so a
  // transform applied there would stack.
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const texture = useMemo(glow, []);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    proxies.forEach((proxy, index) => {
      footprintRotation.setFromAxisAngle(UP, axisHeading(proxy.heading_rad));
      footprintMatrix.compose(
        new Vector3(...toWorld(proxy.center, HEIGHT.footprint)),
        footprintRotation,
        new Vector3(proxy.length_m * GLOW_SCALE.length, 1, proxy.width_m * GLOW_SCALE.width),
      );
      mesh.current!.setMatrixAt(index, footprintMatrix);
    });
    mesh.current.count = proxies.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [proxies, invalidate]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, capacity(proxies.length)]} key={capacity(proxies.length)} renderOrder={STATUS_ORDER.footprint}>
      {/* Blended, but not `transparent`: that would move it to three's later transparent list and over
          the motorcycles. Custom blending keeps it in the opaque list, in status order, under them,
          and leaves the canvas alpha opaque. */}
      <meshBasicMaterial
        map={texture}
        blending={CustomBlending}
        blendSrcAlpha={ZeroFactor}
        blendDstAlpha={OneFactor}
        depthTest={false}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** Room for a few more instances, so a new detection rarely recreates the mesh. */
function capacity(count: number): number {
  return Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(count, 1))));
}

const motorcycleMatrix = new Matrix4();
const motorcycleRotation = new Quaternion();
const paintColor = new Color();

/** One instance per proxy on its footprint. A token keeps its own height; the model's follows its length. */
function placeMotorcycles(mesh: InstancedMesh, proxies: MotorcycleProxy[], token: boolean) {
  proxies.forEach((proxy, index) => {
    const { position, rotationY, scale } = motorcycleTransform(proxy);
    motorcycleRotation.setFromAxisAngle(UP, rotationY);
    motorcycleMatrix.compose(new Vector3(...position), motorcycleRotation, new Vector3(scale[0], token ? 1 : scale[1], scale[2]));
    mesh.setMatrixAt(index, motorcycleMatrix);
  });
  mesh.count = proxies.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/**
 * Every motorcycle as a rounded token covering its footprint, in one instanced draw, while the model
 * loads. Until then the token is the occupied mark itself, so it is the occupied red, lit so its shape reads.
 */
function Tokens({ proxies }: { proxies: MotorcycleProxy[] }) {
  const geometry = useMemo(
    () => new RoundedBoxGeometry(MOTORCYCLE_MODEL.lengthM, TOKEN_HEIGHT_M, MOTORCYCLE_MODEL.widthM, 2, TOKEN_RADIUS_M).translate(0, TOKEN_HEIGHT_M / 2, 0),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  const redraw = useRedraw();
  useLayoutEffect(() => {
    if (!mesh.current) return;
    placeMotorcycles(mesh.current, proxies, true);
    redraw();
  }, [proxies, redraw]);
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, capacity(proxies.length)]}
      key={capacity(proxies.length)}
      renderOrder={STATUS_ORDER.motorcycle}
      castShadow
      receiveShadow
    >
      <meshLambertMaterial color={COLORS.OCCUPIED} />
    </instancedMesh>
  );
}

/**
 * The generic model on every proxy, in one instanced draw, at every zoom, so a motorcycle reads as one
 * from the overview on. It is the same proxy on the same footprint as the token it replaces.
 */
function Motorcycles({ proxies, onReady }: { proxies: MotorcycleProxy[]; onReady(): void }) {
  // No Draco or Meshopt: the model is plain glTF from this app's own origin.
  const { scene } = useGLTF(MOTORCYCLE_MODEL.url, false, false);
  const geometry = useMemo(() => (scene.getObjectByName("motorcycle") as Mesh).geometry, [scene]);
  const model = useRef<InstancedMesh>(null);
  const redraw = useRedraw();
  useLayoutEffect(() => {
    if (!model.current) return;
    placeMotorcycles(model.current, proxies, false);
    proxies.forEach((proxy, index) => model.current!.setColorAt(index, paintColor.set(motorcyclePaint(proxy.center))));
    if (model.current.instanceColor) model.current.instanceColor.needsUpdate = true;
    redraw();
  }, [proxies, redraw]);
  useEffect(onReady, [onReady]);
  return (
    <instancedMesh
      ref={model}
      args={[geometry, undefined, capacity(proxies.length)]}
      key={capacity(proxies.length)}
      renderOrder={STATUS_ORDER.motorcycle}
      castShadow
      receiveShadow
    >
      {/* White, so each motorcycle shows its own grey paint; the vertex shades darken tyres, seat, and trim. */}
      <meshLambertMaterial color="#ffffff" vertexColors />
    </instancedMesh>
  );
}

function Ground({
  map,
  onSelect,
  onReady,
}: {
  map: LotMap;
  onSelect(point: MetricPoint | null): void;
  onReady(): void;
}) {
  const { hatch, dots, asphalt, paint } = usePatterns();
  const { minX, minY, maxX, maxY } = map.site;
  const site = useMemo(
    (): MetricPolygon => [
      [
        { x_m: minX, y_m: minY },
        { x_m: maxX, y_m: minY },
        { x_m: maxX, y_m: maxY },
        { x_m: minX, y_m: maxY },
      ],
    ],
    [minX, minY, maxX, maxY],
  );
  const proxies = useMemo(() => map.areas.flatMap((area) => area.motorcycles.map(({ displayProxy }) => displayProxy)), [map]);
  const redraw = useRedraw();
  // Demand rendering does not draw newly mounted meshes by itself, so new data asks for a frame,
  // with fresh shadows for any block, tree, or motorcycle it moved.
  useEffect(() => redraw(), [map, redraw]);
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
      {/* The site is paved to its extent and kerbed at its edge; the lot is the same asphalt. */}
      <Surface polygon={site} height={HEIGHT.site} map={asphalt} />
      <Outline polygon={site} height={HEIGHT.site + 0.005} color={COLORS.CURB} width={2} />
      {/* A kerb along the lot's edge, so the lot stands apart from the paving around it. */}
      <Outline polygon={map.outline} height={HEIGHT.lot + 0.005} color={COLORS.CURB} width={3} />
      {map.unmonitored.map((polygon, index) => (
        <Surface key={index} polygon={polygon} height={HEIGHT.unmonitored} map={dots} />
      ))}
      <Surroundings landmarks={map.landmarks} asphalt={asphalt} />
      {map.areas.map((area) => (
        <group key={area.parkingAreaId}>
          {/* Where no region covers it, a monitored area shows the asphalt it is: still a status layer, so nothing in front hides it. */}
          <Surface polygon={area.polygon} height={HEIGHT.area} map={area.unknownReason ? hatch : asphalt} statusOrder={STATUS_ORDER.area} />
          <Outline polygon={area.polygon} height={HEIGHT.area} color={COLORS.PARKING_AREA_STROKE} width={1} statusOrder={STATUS_ORDER.areaStroke} />
          {area.regions.map((region, index) => (
            <group key={index}>
              <Surface
                polygon={region.polygon}
                height={HEIGHT.region}
                color={region.kind === "UNKNOWN" ? undefined : statusPaint(COLORS[region.kind])}
                map={region.kind === "UNKNOWN" ? hatch : paint}
                statusOrder={STATUS_ORDER.region}
              />
              {region.kind !== "UNKNOWN" && (
                <Outline
                  polygon={region.polygon}
                  height={HEIGHT.region}
                  color={region.kind === "OCCUPIED" ? COLORS.OCCUPIED : (region.kind === "AVAILABLE" || region.kind === "WIDTH_SUFFICIENT") ? COLORS.AVAILABLE_STROKE : COLORS.ALMOST_AVAILABLE_STROKE}
                  width={3}
                  dashed={region.kind === "ALMOST_AVAILABLE"}
                  statusOrder={STATUS_ORDER.regionStroke}
                />
              )}
            </group>
          ))}
        </group>
      ))}
      <Footprints proxies={map.areas.filter(area => !area.regions.some(region => region.kind === "OCCUPIED")).flatMap(area => area.motorcycles.map(({ displayProxy }) => displayProxy))} />
      {/* The model loads behind Suspense; tokens and the rest of the map show at once. */}
      <Suspense fallback={<Tokens proxies={proxies} />}>
        <Motorcycles proxies={proxies} onReady={onReady} />
      </Suspense>
    </>
  );
}

/**
 * The one fixed directional light. Its shadow camera covers the lot and every landmark, with room
 * for the tallest one's shadow, so the map's shadows never end at an arbitrary line.
 */
function Sun({ map }: { map: LotMap }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const redraw = useRedraw();
  const reach = useMemo(() => {
    const { minX, minY, maxX, maxY } = map.site;
    const tallest = Math.max(MOTORCYCLE_MODEL.heightM, ...map.landmarks.map((landmark) => landmark.height_m ?? 0));
    return { centre: { x_m: (minX + maxX) / 2, y_m: (minY + maxY) / 2 }, radius: Math.hypot(maxX - minX, maxY - minY) / 2 + tallest };
  }, [map.site, map.landmarks]);
  useLayoutEffect(() => {
    if (!light.current) return;
    const { centre, radius } = reach;
    target.position.set(...toWorld(centre));
    target.updateMatrixWorld();
    light.current.position.copy(target.position).addScaledVector(LIGHT_DIRECTION, radius * 2);
    const camera = light.current.shadow.camera;
    camera.left = camera.bottom = -radius;
    camera.right = camera.top = radius;
    camera.near = radius;
    camera.far = radius * 3;
    camera.updateProjectionMatrix();
    redraw();
  }, [reach, target, redraw]);
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        color={LIGHT_COLOR}
        intensity={LIGHT_INTENSITY}
        castShadow
        shadow-mapSize={[SHADOW_MAP_PX, SHADOW_MAP_PX]}
        shadow-radius={4}
        shadow-intensity={SHADOW_INTENSITY}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
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

/** Owns the camera: overview on mount and resize, zoom and tilt limits, pan kept over the lot, moves, and labels. */
function CameraRig({
  map,
  insets,
  handle,
  labels,
}: {
  map: LotMap;
  insets: MapViewProps["insets"];
  handle: React.Ref<MapViewHandle>;
  labels: React.RefObject<LabelLayerHandle | null>;
}) {
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const { camera, size, invalidate } = useThree();
  // The overview fits the lot outline; pan reaches every way in. Plain numbers, so a poll that
  // rebuilds the map with the same geometry does not refit.
  const { minX, minY, maxX, maxY } = map.frame;
  const { top, right, bottom, left } = insets;
  const { width, height } = size;
  const overview = useMemo(
    () => overview3D({ minX, minY, maxX, maxY }, { width, height, insets: { top, right, bottom, left } }),
    [minX, minY, maxX, maxY, width, height, top, right, bottom, left],
  );
  const atOverview = useRef(true);
  const flight = useRef<Flight | null>(null);
  const latestBounds = useRef(map.bounds);
  latestBounds.current = map.bounds;
  const zoomLimit = useRef(0);
  zoomLimit.current = overview.distance / MIN_ZOOM;
  // How far out the camera may be: the zoom limit, or further while it is still coming in from the
  // wide opening view. It only ever tightens toward the limit, so reaching it never pulls the camera in.
  const ceiling = useRef(Infinity);
  const tighten = useCallback((distance: number) => {
    ceiling.current = Math.max(zoomLimit.current, Math.min(ceiling.current, distance));
    if (controls.current) controls.current.maxDistance = ceiling.current;
  }, []);

  function current(): View3D {
    const target = controls.current!.target;
    return viewFrom([camera.position.x, camera.position.y, camera.position.z], fromWorld(target.x, target.z));
  }

  /** The view inside the zoom and tilt limits, with its target kept over the lot. */
  function clampView(view: View3D): View3D {
    return {
      ...view,
      distance: Math.min(ceiling.current, Math.max(overview.distance / MAX_ZOOM, view.distance)),
      elevationRad: Math.min(MAX_ELEVATION_RAD, Math.max(MIN_ELEVATION_RAD, view.elevationRad)),
      target: clampToBounds(view.target, map.bounds),
    };
  }

  function apply(view: View3D) {
    if (!controls.current) return;
    const clamped = clampView(view);
    tighten(clamped.distance);
    camera.position.set(...cameraPosition(clamped));
    controls.current.target.set(...toWorld(clamped.target));
    controls.current.update();
    invalidate();
  }

  /** When the move under way lands, on the `performance.now()` clock. */
  const landing = useRef(0);

  /** Glides from the view on screen to `target`, or jumps there when `ms` is 0. */
  function moveTo(target: View3D, ms: number, ease: (t: number) => number) {
    flight.current?.cancel();
    if (!controls.current) return;
    landing.current = performance.now() + ms;
    const from = current();
    const to = clampView(target);
    flight.current = fly(ms, ease, (t) => apply(mix3D(from, to, t)));
  }

  // The first fit opens on the wide view and flies in to the overview. After that a resize, such as
  // the sheet growing, refits the overview, and a move on its way there is sent to the new one in the
  // time it had left, so new data arriving during the opening flight does not hurry it.
  // Once people have moved the view, neither a resize nor new data moves it again.
  const opened = useRef(false);
  const refit = useRef(() => {});
  refit.current = () => {
    if (!controls.current) return;
    if (!opened.current) {
      opened.current = true;
      apply(introView3D({ minX, minY, maxX, maxY }, map.site, { width, height, insets: { top, right, bottom, left } }));
      moveTo(overview, INTRO_MS, easeInOut);
      return;
    }
    // A new size moves the zoom limit, which the camera may already be inside.
    tighten(camera.position.distanceTo(controls.current.target));
    if (!atOverview.current) return;
    if (flight.current?.active) {
      moveTo(overview, Math.max(NUDGE_MS, landing.current - performance.now()), easeOut);
      return;
    }
    flight.current?.cancel();
    apply(overview);
  };
  useLayoutEffect(() => refit.current(), [overview]);
  useEffect(() => () => flight.current?.cancel(), []);

  useImperativeHandle(handle, () => ({
    zoomBy(factor, animated) {
      atOverview.current = false;
      const view = current();
      moveTo({ ...view, distance: view.distance / factor }, animated ? NUDGE_MS : 0, easeOut);
    },
    reset(animated) {
      atOverview.current = true;
      moveTo(overview, animated ? FLY_MS : 0, easeInOut);
    },
    focus(point) {
      atOverview.current = false;
      const view = current();
      // With the point as the target it sits mid-screen; dragging by the free area's offset from
      // mid-screen moves it to the middle of the map left uncovered.
      const offsetX = left + (width - left - right) / 2 - width / 2;
      const offsetY = top + (height - top - bottom) / 2 - height / 2;
      const centred = { ...view, target: point, distance: Math.min(view.distance, overview.distance / 2) };
      moveTo(pan3D(centred, offsetX, offsetY, height), FLY_MS, easeInOut);
    },
    panBy(dx, dy) {
      atOverview.current = false;
      moveTo(pan3D(current(), dx, dy, height), 0, easeOut);
    },
    rotateBy(rad, animated) {
      atOverview.current = false;
      // Moving the camera clockwise around the target turns the map counter-clockwise on screen.
      const view = current();
      moveTo({ ...view, azimuthRad: view.azimuthRad - rad }, animated ? NUDGE_MS : 0, easeOut);
    },
    reveal(point, cover) {
      if (flight.current?.active || !controls.current) return;
      const projected = new Vector3(...toWorld(point)).project(camera);
      if (projected.z > 1) return;
      const offset = revealOffset(((1 - projected.y) / 2) * height, height, top, cover);
      if (offset === 0) return;
      atOverview.current = false;
      moveTo(pan3D(current(), 0, offset, height), NUDGE_MS, easeOut);
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
    tighten(camera.position.distanceTo(target));
  }, [camera, tighten]);
  // Touching the map takes over from any move under way.
  const onStart = useCallback(() => {
    flight.current?.cancel();
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
      // maxDistance is set by `tighten`, so the opening flight can start beyond the zoom limit.
      onStart={onStart}
      onChange={onChange}
    />
  );
}

export default function LotScene({ map, labels, selection, onSelect, insets, onReady, onError, ref }: MapViewProps & { onReady(): void; onError(): void }) {
  const labelLayer = useRef<LabelLayerHandle>(null);
  // Hidden until the scene has rendered, then faded in over the skeleton.
  const [created, setCreated] = useState(false);
  return (
    <div
      className={cn("relative size-full transition-opacity duration-300 ease-out motion-reduce:transition-none", !created && "opacity-0")}
      style={{ backgroundColor: COLORS.GROUND }}
    >
      <Canvas
        dpr={[1, MAX_DPR]}
        frameloop="demand"
        shadows={SHADOWS}
        camera={{ fov: FOV_DEG, near: 0.5, far: 2000 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", onError);
          setCreated(true);
        }}
      >
        <color attach="background" args={[COLORS.GROUND]} />
        {/* A slightly cool sky over a warm ground bounce, and one fixed light, so walls and roofs read apart. */}
        <hemisphereLight args={[SKY_COLOR, BOUNCE_COLOR, SKY_INTENSITY]} />
        <Sun map={map} />
        <Ground map={map} onSelect={onSelect} onReady={onReady} />
        {selection?.polygon && <Selection polygon={selection.polygon} />}
        <CameraRig map={map} insets={insets} handle={ref ?? null} labels={labelLayer} />
      </Canvas>
      <LabelLayer ref={labelLayer} labels={labels} selection={selection} insets={insets} />
    </div>
  );
}

useGLTF.preload(MOTORCYCLE_MODEL.url, false, false);
