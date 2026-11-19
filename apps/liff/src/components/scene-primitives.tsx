"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, Path, RepeatWrapping, SRGBColorSpace, Shape, Vector2 } from "three";
import type { MetricPolygon } from "@/lib/api/types";
import { toWorld } from "@/lib/map/geometry";

// Pieces the 3D lot view and its surroundings share.

// Layer heights keep coplanar surfaces from flickering.
export const HEIGHT = { ground: -0.02, site: -0.01, lot: 0, unmonitored: 0.01, area: 0.02, landmark: 0.025, region: 0.03, footprint: 0.04, selection: 0.06 };
const PATTERN_TILE_M = 0.8;

export function toShape([outer, ...holes]: MetricPolygon): Shape {
  const shape = new Shape(outer.map((point) => new Vector2(point.x_m, point.y_m)));
  shape.holes = holes.map((ring) => new Path(ring.map((point) => new Vector2(point.x_m, point.y_m))));
  return shape;
}

/** A repeating sRGB texture drawn on a canvas of this size. */
export function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A repeating pattern, in metres: shape and extruded wall UVs are the metric coordinates themselves. */
export function pattern(background: string, draw: (context: CanvasRenderingContext2D) => void, tileM = PATTERN_TILE_M, px = 32): CanvasTexture {
  const texture = canvasTexture(px, px, (context) => {
    context.fillStyle = background;
    context.fillRect(0, 0, px, px);
    draw(context);
  });
  texture.repeat.set(1 / tileM, 1 / tileM);
  return texture;
}

/** A small seeded generator, so a procedural pattern is the same on every load. */
export function grain(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ASPHALT = { tileM: 8, px: 256, patches: 28, aggregate: 9000 };

/**
 * Asphalt over an 8 m tile: broad, faint patches of wear under fine light and dark aggregate. A
 * patch is drawn again across every edge it crosses, so the tile repeats without a seam.
 */
export function asphalt(background: string, grainStrength = 1): CanvasTexture {
  const { px } = ASPHALT;
  const random = grain(ASPHALT.px + ASPHALT.patches);
  return pattern(
    background,
    (context) => {
      context.globalAlpha = grainStrength;
      for (let index = 0; index < ASPHALT.patches; index += 1) {
        const [x, y] = [random() * px, random() * px];
        const radius = (0.08 + random() * 0.17) * px;
        const rgb = random() < 0.5 ? "255, 255, 255" : "0, 0, 0";
        const alpha = 0.025 + random() * 0.035;
        for (const dx of [-px, 0, px]) {
          for (const dy of [-px, 0, px]) {
            const gradient = context.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
            gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${rgb}, 0)`);
            context.fillStyle = gradient;
            context.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
          }
        }
      }
      for (let index = 0; index < ASPHALT.aggregate; index += 1) {
        context.fillStyle = random() < 0.5 ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.12)";
        context.fillRect(Math.floor(random() * px), Math.floor(random() * px), 1, 1);
      }
    },
    ASPHALT.tileM,
    px,
  );
}

/**
 * A `map` is tinted by `color`, or shown as drawn without one.
 * `statusOrder` marks a status layer: unlit, and drawn in that order after the scene without a depth
 * test, so no light, shadow, or block tints it. A status colour also skips tone mapping, which would
 * wash it out to a pastel unlike the legend's; a pattern alone, such as the asphalt, is tone mapped
 * like the lit paving around it. Every other surface is lit and takes shadows.
 */
export function Surface({ polygon, height, color, map, statusOrder }: { polygon: MetricPolygon; height: number; color?: string; map?: CanvasTexture; statusOrder?: number }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  const status = statusOrder !== undefined;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} renderOrder={statusOrder ?? 0} receiveShadow={!status}>
      <shapeGeometry args={[shape]} />
      {/* A new material when the pattern comes or goes: three does not recompile a shader for a changed map. */}
      {status ? (
        <meshBasicMaterial key={map?.uuid ?? "plain"} color={color ?? "#ffffff"} map={map} depthTest={false} toneMapped={!color} />
      ) : (
        <meshLambertMaterial key={map?.uuid ?? "plain"} color={color ?? "#ffffff"} map={map} />
      )}
    </mesh>
  );
}

export function Outline({
  polygon,
  height,
  color,
  width,
  dashed = false,
  highlight,
  statusOrder,
}: {
  polygon: MetricPolygon;
  height: number;
  color: string;
  width: number;
  dashed?: boolean;
  highlight?: string;
  statusOrder?: number;
}) {
  const points = useMemo(() => polygon[0].concat(polygon[0][0]).map((point) => toWorld(point, height)), [polygon, height]);
  if (highlight) return <RevealingOutline points={points} color={color} highlight={highlight} width={width} statusOrder={statusOrder} />;
  return (
    <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.3} gapSize={0.2} renderOrder={statusOrder ?? 0} depthTest={statusOrder === undefined} />
  );
}

/** One short reveal, then the demand-rendered map can go idle again. */
function RevealingOutline({ points, color, highlight, width, statusOrder }: {
  points: ReturnType<typeof toWorld>[];
  color: string;
  highlight: string;
  width: number;
  statusOrder?: number;
}) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const startedAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const base = useMemo(() => new Color(color), [color]);
  const accent = useMemo(() => new Color(highlight), [highlight]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    startedAt.current = performance.now();
    invalidate();
  }, [invalidate]);
  useFrame(() => {
    if (startedAt.current === null || !line.current) return;
    const progress = Math.min(1, (performance.now() - startedAt.current) / 1200);
    line.current.material.color.copy(base).lerp(accent, Math.sin(progress * Math.PI));
    if (progress < 1) invalidate();
    else startedAt.current = null;
  });
  return <Line ref={line} points={points} color={color} lineWidth={width} renderOrder={statusOrder ?? 0} depthTest={statusOrder === undefined} />;
}
