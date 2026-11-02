'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LANDMARK_COLORS, modelBounds } from '../../lib/lotModelEditor';
import type { LotModelDefinition, MetricPolygon } from '../../types/lotModel';

function footprint(polygon: MetricPolygon): THREE.Shape {
  const shape = new THREE.Shape(polygon[0].map((p) => new THREE.Vector2(p.x_m, p.y_m)));
  shape.holes = polygon.slice(1).map((ring) => new THREE.Path(ring.map((p) => new THREE.Vector2(p.x_m, p.y_m))));
  return shape;
}

function dispose(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
  });
  group.clear();
}

function addFootprint(group: THREE.Group, polygon: MetricPolygon, color: string, height = 0, y = 0) {
  const shape = footprint(polygon);
  const geometry = height > 0 ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
  mesh.position.y = y; group.add(mesh);
}

/** A static shape preview, never an availability calculation or a camera reconstruction. */
export function LotModelPreview({ model }: { model: LotModelDefinition }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(model);
  useEffect(() => { latest.current = model; }, [model]);
  const engine = useRef<{ scene: THREE.Scene; group: THREE.Group; render: () => void; fit: () => void } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canvas.current) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, powerPreference: 'low-power' }); }
    catch {
      queueMicrotask(() => setError('เครื่องนี้เปิด WebGL ไม่ได้ ยังแก้ไขแผนผังในมุมมอง 2D ได้ตามปกติ'));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f8f9fb');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, canvas.current);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    const group = new THREE.Group(); scene.add(group);
    scene.add(new THREE.HemisphereLight('#ffffff', '#a9b2c0', 2));
    const sun = new THREE.DirectionalLight('#ffffff', 2.5); sun.position.set(30, 70, 40); scene.add(sun);
    const render = () => renderer.render(scene, camera);
    const fit = () => {
      const bounds = modelBounds(latest.current);
      const height = Math.max(0, ...(latest.current.landmarks ?? []).map((landmark) => landmark.height_m ?? 0));
      const size = Math.max(15, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, height);
      const center = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, height / 4, -(bounds.minY + bounds.maxY) / 2);
      camera.position.copy(center).add(new THREE.Vector3(size * 0.9, size * 1.25, size * 1.1));
      controls.target.copy(center); controls.update(); render();
    };
    engine.current = { scene, group, render, fit };
    controls.addEventListener('change', render);
    const element = canvas.current;
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
    });
    resize.observe(element); fit();
    const lost = (event: Event) => { event.preventDefault(); setError('การแสดงผล 3D หยุดทำงาน กรุณากลับไปใช้ 2D'); };
    element.addEventListener('webglcontextlost', lost);
    return () => {
      resize.disconnect(); element.removeEventListener('webglcontextlost', lost);
      controls.dispose(); dispose(group); renderer.dispose(); engine.current = null;
    };
  }, []);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    dispose(current.group);
    addFootprint(current.group, model.outline, '#e2e8f0', 0, -0.04);
    for (const landmark of model.landmarks ?? []) {
      const color = LANDMARK_COLORS[landmark.kind];
      if (landmark.polygon) {
        if (landmark.kind === 'SHELTER' && landmark.height_m) {
          addFootprint(current.group, landmark.polygon, color, 0.15, landmark.height_m);
          for (const point of landmark.polygon[0]) {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, landmark.height_m, 6), new THREE.MeshStandardMaterial({ color: '#64748b' }));
            pole.position.set(point.x_m, landmark.height_m / 2, -point.y_m); current.group.add(pole);
          }
        } else addFootprint(current.group, landmark.polygon, color, landmark.height_m ?? 0, landmark.height_m ? 0 : 0.01);
      } else if (landmark.kind === 'TREE') {
        const height = landmark.height_m!, radius = landmark.radius_m!, crown = Math.min(height * 0.4, radius * 0.8);
        const trunkHeight = height - crown;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, trunkHeight, 7), new THREE.MeshStandardMaterial({ color: '#8b7761' }));
        trunk.position.set(landmark.position.x_m, trunkHeight / 2, -landmark.position.y_m);
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color }));
        canopy.scale.set(radius, crown, radius); canopy.position.set(landmark.position.x_m, height - crown, -landmark.position.y_m);
        current.group.add(trunk, canopy);
      } else if (landmark.line) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(landmark.line.map((p) => new THREE.Vector3(p.x_m, 0.15, -p.y_m))), new THREE.LineBasicMaterial({ color }));
        current.group.add(line);
      } else {
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 12), new THREE.MeshStandardMaterial({ color }));
        marker.position.set(landmark.position.x_m, 0.08, -landmark.position.y_m); current.group.add(marker);
        if (landmark.direction_rad != null) {
          current.group.add(new THREE.ArrowHelper(new THREE.Vector3(Math.cos(landmark.direction_rad), 0, -Math.sin(landmark.direction_rad)),
            new THREE.Vector3(landmark.position.x_m, 0.2, -landmark.position.y_m), 2, '#46658a'));
        }
      }
    }
    for (const area of model.parking_areas) {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(area.polygon[0].map((p) => new THREE.Vector3(p.x_m, 0.06, -p.y_m))), new THREE.LineBasicMaterial({ color: '#60a5fa', depthTest: false }));
      line.renderOrder = 2; current.group.add(line);
    }
    current.render();
  }, [model]);

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="ตัวอย่างรูปทรงสามมิติ">
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
      <span>ลากเพื่อหมุน · คลิกขวาเพื่อเลื่อน · หมุนล้อเพื่อซูม</span>
      <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50" onClick={() => engine.current?.fit()}>แสดงทั้งหมด</button>
    </div>
    {error ? <div className="flex h-[560px] items-center justify-center p-8 text-sm text-slate-600" role="status">{error}</div>
      : <canvas ref={canvas} className="h-[560px] w-full" aria-label="ตัวอย่าง 3D จากขนาดที่กรอก" />}
    <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">ตัวอย่างรูปทรงจากโมเดล · ไม่มีสถานะจอดรถ · แก้จุดมุมในมุมมอง 2D</p>
  </section>;
}
