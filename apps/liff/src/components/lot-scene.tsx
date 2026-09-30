"use client";

import { Instance, Instances, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { Path, Shape, Vector2 } from "three";
import type { LotModel, MetricPolygon, ParkingAreaLiveState } from "@/lib/api/types";
import { COLORS } from "@/lib/parking/presentation";

// Metric ground (x_m, y_m) maps to world (x, 0, -y); the Y axis points up.
const MOTORCYCLE_HEIGHT_M = 1.1;

function toShape([outer, ...holes]: MetricPolygon): Shape {
  const shape = new Shape(outer.map((point) => new Vector2(point.x_m, point.y_m)));
  shape.holes = holes.map((ring) => new Path(ring.map((point) => new Vector2(point.x_m, point.y_m))));
  return shape;
}

function Surface({ polygon, color, height }: { polygon: MetricPolygon; color: string; height: number }) {
  const shape = useMemo(() => toShape(polygon), [polygon]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function AreaLayer({ area, polygon }: { area: ParkingAreaLiveState | undefined; polygon: MetricPolygon }) {
  // Anything not proven live is shown as unknown ground, never as free space.
  if (area?.status !== "LIVE") {
    return <Surface polygon={polygon} color={COLORS.UNKNOWN} height={0.01} />;
  }
  return (
    <>
      <Surface polygon={polygon} color={COLORS.PARKING_AREA} height={0.01} />
      {area.regions?.map((region, index) => (
        <Surface key={index} polygon={region.polygon} color={COLORS[region.kind]} height={0.02} />
      ))}
      {area.motorcycles && area.motorcycles.length > 0 && (
        <Instances limit={area.motorcycles.length}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={COLORS.MOTORCYCLE} />
          {area.motorcycles.map((proxy) => (
            <Instance
              key={proxy.detection_id}
              position={[proxy.center.x_m, MOTORCYCLE_HEIGHT_M / 2, -proxy.center.y_m]}
              rotation={[0, proxy.heading_rad, 0]}
              scale={[proxy.length_m, MOTORCYCLE_HEIGHT_M, proxy.width_m]}
            />
          ))}
        </Instances>
      )}
    </>
  );
}

function bounds(polygon: MetricPolygon) {
  const xs = polygon[0].map((point) => point.x_m);
  const ys = polygon[0].map((point) => point.y_m);
  const center: [number, number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, 0, -(Math.min(...ys) + Math.max(...ys)) / 2];
  return { center, span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
}

export default function LotScene({ lotModel, areas }: { lotModel: LotModel; areas: ParkingAreaLiveState[] }) {
  const { center, span } = useMemo(() => bounds(lotModel.outline), [lotModel.outline]);
  const areasById = new Map(areas.map((area) => [area.parking_area_id, area]));
  return (
    <Canvas dpr={[1, 2]} frameloop="demand" camera={{ position: [center[0], span * 0.9, center[2] + span * 0.9], fov: 45 }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <Surface polygon={lotModel.outline} color={COLORS.LOT} height={0} />
      {lotModel.unmonitored.map((polygon, index) => (
        <Surface key={index} polygon={polygon} color={COLORS.UNMONITORED} height={0.005} />
      ))}
      {lotModel.parking_areas.map((area) => (
        <AreaLayer key={area.parking_area_id} area={areasById.get(area.parking_area_id)} polygon={area.polygon} />
      ))}
      <OrbitControls target={center} maxPolarAngle={Math.PI / 2.2} minDistance={2} maxDistance={span * 3} />
    </Canvas>
  );
}
