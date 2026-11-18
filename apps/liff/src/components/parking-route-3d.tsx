import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { DoubleSide, type ShaderMaterial } from "three";
import type { MetricPoint } from "@/lib/api/types";
import { parkingRibbon } from "@/lib/map/parking-ribbon";
import { ROUTE_FLOW_S, routeFlowOpacity } from "@/lib/map/route-reveal";
import { HEIGHT } from "./scene-primitives";

const FLOW_SPEED = 3.6;

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
  uniform float uFlowOpacity;
  uniform float uRevealing;

  void main() {
    float behind = uDistance - vRoute.x;
    if (behind < 0.0) discard;

    float lateral = abs(vRoute.y - 0.5);
    float face = 1.0 - smoothstep(0.309, 0.328, lateral);
    float rail = smoothstep(0.253, 0.291, lateral) * face;
    vec3 color = mix(vec3(0.004, 0.02, 0.085), vec3(0.012, 0.16, 0.68), face);
    color = mix(color, vec3(0.08, 0.57, 1.0), rail);

    // The stripe peaks at the centre and falls back on both sides to point forward.
    float phase = mod(vRoute.x - uFlow, 3.3);
    float chevron = 1.0 - smoothstep(0.10, 0.19, abs(phase - (1.8 - lateral * 2.6)));
    chevron *= (1.0 - smoothstep(0.22, 0.28, lateral)) * (1.0 - uRevealing) * uFlowOpacity;
    float head = 1.0 - smoothstep(0.09, 0.17, abs(behind - (0.14 + lateral * 3.0)));
    head *= (1.0 - smoothstep(0.26, 0.31, lateral)) * uRevealing;
    float leadingGlow = exp(-behind * 1.65) * uRevealing * face;
    color = mix(color, vec3(0.03, 0.65, 1.0), leadingGlow);
    color = mix(color, vec3(0.84, 0.97, 1.0), max(chevron, head));
    float opacity = (1.0 - smoothstep(0.38, 0.50, lateral)) * smoothstep(0.0, 0.10, uDistance);
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
    uFlowOpacity: { value: 1 },
    uRevealing: { value: 0 },
  }), []);
  const length = geometry?.length ?? 0;
  const routeKey = route?.map(({ x_m, y_m }) => `${x_m},${y_m}`).join(" ");
  useLayoutEffect(() => {
    elapsed.current = 0;
    animate.current = !!routeKey && (!!replay || !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (material.current) {
      material.current.uniforms.uFlow.value = 0;
      material.current.uniforms.uFlowOpacity.value = 1;
    }
    invalidate();
  }, [routeKey, replay, invalidate]);

  useLayoutEffect(() => {
    if (!material.current) return;
    material.current.uniforms.uDistance.value = progress * length;
    material.current.uniforms.uRevealing.value = Number(progress < 1);
    invalidate();
  }, [geometry, length, progress, invalidate]);

  useFrame((_, delta) => {
    if (!material.current || !animate.current || material.current.uniforms.uRevealing.value || elapsed.current >= ROUTE_FLOW_S) return;
    elapsed.current = Math.min(ROUTE_FLOW_S, elapsed.current + Math.min(delta, 0.05));
    material.current.uniforms.uFlow.value = elapsed.current * FLOW_SPEED;
    material.current.uniforms.uFlowOpacity.value = routeFlowOpacity(elapsed.current);
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
