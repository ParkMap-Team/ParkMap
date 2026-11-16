import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { DoubleSide, type ShaderMaterial } from "three";
import type { MetricPoint } from "@/lib/api/types";
import { parkingRibbon } from "@/lib/map/parking-ribbon";
import { HEIGHT } from "./scene-primitives";

const FLOW_SECONDS = 7;
const FLOW_SPEED = 4.8;

const vertexShader = /* glsl */ `
  varying vec2 vRoute;
  void main() {
    vRoute = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vRoute;
  uniform float uDistance;
  uniform float uFlow;
  uniform float uRevealing;

  void main() {
    float behind = uDistance - vRoute.x;
    if (behind < 0.0) discard;

    float lateral = abs(vRoute.y - 0.5);
    float surface = 1.0 - smoothstep(0.295, 0.34, lateral);
    float edge = smoothstep(0.22, 0.30, lateral) * surface;
    float fringe = smoothstep(0.34, 0.49, lateral);
    vec3 color = mix(vec3(0.015, 0.07, 0.32), vec3(0.015, 0.26, 0.82), surface);
    color = mix(color, vec3(0.08, 0.8, 1.0), edge);
    color = mix(color, vec3(0.04, 0.53, 1.0), fringe);

    // The stripe peaks at the centre and falls back on both sides to point forward.
    float phase = mod(vRoute.x - uFlow, 3.0);
    float chevron = 1.0 - smoothstep(0.07, 0.17, abs(phase - (1.8 - lateral * 2.35)));
    chevron *= 1.0 - smoothstep(0.19, 0.26, lateral);
    float leadingGlow = exp(-behind * 3.2) * uRevealing * surface;
    color = mix(color, vec3(0.72, 0.95, 1.0), max(chevron * 0.9, leadingGlow));
    float opacity = (1.0 - smoothstep(0.32, 0.50, lateral)) * smoothstep(0.0, 0.10, uDistance);
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
  }
`;

export function ParkingRoute3D({ route, progress, replay }: {
  route: readonly MetricPoint[] | undefined;
  progress: number;
  replay: number | undefined;
}) {
  const geometry = useMemo(() => route && parkingRibbon(route, HEIGHT.selection + 0.015), [route]);
  const material = useRef<ShaderMaterial>(null);
  const elapsed = useRef(0);
  const animate = useRef(false);
  const invalidate = useThree((state) => state.invalidate);
  const uniforms = useMemo(() => ({
    uDistance: { value: 0 },
    uFlow: { value: 0 },
    uRevealing: { value: 0 },
  }), []);
  const length = geometry?.length ?? 0;
  const routeKey = route?.map(({ x_m, y_m }) => `${x_m},${y_m}`).join(" ");
  useLayoutEffect(() => {
    elapsed.current = 0;
    animate.current = !!routeKey && (!!replay || !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (material.current) material.current.uniforms.uFlow.value = 0;
    invalidate();
  }, [routeKey, replay, invalidate]);

  useLayoutEffect(() => {
    if (!material.current) return;
    material.current.uniforms.uDistance.value = progress * length;
    material.current.uniforms.uRevealing.value = Number(progress < 1);
    invalidate();
  }, [geometry, length, progress, invalidate]);

  useFrame((_, delta) => {
    if (!material.current || !animate.current || elapsed.current >= FLOW_SECONDS) return;
    elapsed.current = Math.min(FLOW_SECONDS, elapsed.current + Math.min(delta, 0.05));
    material.current.uniforms.uFlow.value = elapsed.current * FLOW_SPEED;
    invalidate();
  });

  if (!geometry) return null;
  return (
    <mesh name="parking-route-ribbon" renderOrder={30}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
        <bufferAttribute attach="attributes-uv" args={[geometry.uvs, 2]} />
        <bufferAttribute attach="index" args={[geometry.indices, 1]} />
      </bufferGeometry>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} side={DoubleSide} transparent depthWrite={false} />
    </mesh>
  );
}
