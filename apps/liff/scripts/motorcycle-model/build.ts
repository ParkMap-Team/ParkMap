// Builds public/models/motorcycle.glb: a generic, low-poly motorcycle made only from three.js
// primitives in this file, so the asset has no third-party source. Run from apps/liff:
//
//   node --experimental-strip-types scripts/motorcycle-model/build.ts
//
// Axes: length along +X, up along +Y, width along Z, metres. The model is centred on the origin
// in X and Z and stands on Y = 0, so the map scales it onto the API's standard footprint.
// Front and rear look alike on purpose: the API resolves the long axis, not the direction.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, TorusGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const COLORS = {
  tyre: "#1f2937",
  hub: "#9ca3af",
  body: "#d1d5db",
  trim: "#6b7280",
  seat: "#374151",
  lamp: "#f3f4f6",
};

type Part = { geometry: BufferGeometry; color: keyof typeof COLORS };

function painted(geometry: BufferGeometry, color: keyof typeof COLORS): Part {
  return { geometry, color };
}

function box(x0: number, x1: number, y0: number, y1: number, halfWidth: number, color: keyof typeof COLORS): Part {
  const geometry = new BoxGeometry(x1 - x0, y1 - y0, halfWidth * 2);
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return painted(geometry, color);
}

/** A rod between two points. */
function rod(from: Vector3, to: Vector3, radius: number, color: keyof typeof COLORS): Part {
  const direction = to.clone().sub(from);
  const geometry = new CylinderGeometry(radius, radius, direction.length(), 10);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  geometry.applyMatrix4(new Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), rotation, new Vector3(1, 1, 1)));
  return painted(geometry, color);
}

function wheel(x: number): Part[] {
  const radius = 0.29;
  const tyre = new TorusGeometry(radius - 0.065, 0.065, 8, 24);
  tyre.translate(x, radius, 0);
  const hub = new CylinderGeometry(0.11, 0.11, 0.1, 12);
  hub.rotateX(Math.PI / 2);
  hub.translate(x, radius, 0);
  return [painted(tyre, "tyre"), painted(hub, "hub")];
}

export function motorcycleParts(): Part[] {
  const head = new Vector3(0.5, 1.0, 0);
  return [
    ...wheel(-0.62),
    ...wheel(0.66),
    box(-0.36, 0.36, 0.24, 0.36, 0.17, "body"), // floorboard
    box(-0.78, -0.08, 0.36, 0.7, 0.18, "body"), // rear body under the seat
    box(-0.72, -0.12, 0.7, 0.79, 0.15, "seat"),
    box(-0.82, -0.5, 0.52, 0.6, 0.12, "trim"), // rear fender
    box(0.3, 0.46, 0.3, 0.94, 0.2, "body"), // leg shield
    box(0.56, 0.78, 0.5, 0.6, 0.1, "trim"), // front fender
    rod(new Vector3(0.66, 0.29, 0.09), new Vector3(0.48, 0.92, 0.09), 0.025, "trim"), // fork
    rod(new Vector3(0.66, 0.29, -0.09), new Vector3(0.48, 0.92, -0.09), 0.025, "trim"),
    rod(new Vector3(0.48, 0.9, 0), head, 0.04, "trim"), // steering column
    box(0.42, 0.62, 0.92, 1.06, 0.12, "body"), // handlebar cover
    box(0.6, 0.66, 0.95, 1.03, 0.06, "lamp"), // headlight
    rod(new Vector3(0.52, 1.02, -0.34), new Vector3(0.52, 1.02, 0.34), 0.018, "trim"), // handlebar
    rod(new Vector3(0.52, 1.02, -0.34), new Vector3(0.52, 1.02, -0.24), 0.026, "seat"), // grips
    rod(new Vector3(0.52, 1.02, 0.24), new Vector3(0.52, 1.02, 0.34), 0.026, "seat"),
  ];
}

/** One mesh with vertex colours, recentred so X and Z are centred and the wheels touch Y = 0. */
export function motorcycleGeometry(): BufferGeometry {
  const parts = motorcycleParts().map(({ geometry, color }) => {
    geometry.deleteAttribute("uv");
    const { r, g, b } = new Color(COLORS[color]).convertSRGBToLinear();
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("color", new Float32BufferAttribute(Array.from({ length: count }, () => [r, g, b]).flat(), 3));
    return geometry;
  });
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("Motorcycle parts could not be merged.");
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  merged.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  merged.computeBoundingBox();
  return merged;
}

function pad(buffer: Buffer, fill: number): Buffer {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(extra, fill)]);
}

/** A minimal glTF 2.0 binary: one mesh, one primitive, one vertex-coloured material. */
export function toGlb(geometry: BufferGeometry): Buffer {
  const position = geometry.getAttribute("position").array as Float32Array;
  const normal = geometry.getAttribute("normal").array as Float32Array;
  const color = geometry.getAttribute("color").array as Float32Array;
  const indexSource = geometry.getIndex()!.array;
  const vertexCount = position.length / 3;
  const index = vertexCount < 65_536 ? Uint16Array.from(indexSource) : Uint32Array.from(indexSource);
  const views = [position, normal, color, index].map((array) => pad(Buffer.from(array.buffer, array.byteOffset, array.byteLength), 0));
  const offsets = views.map((_, i) => views.slice(0, i).reduce((sum, view) => sum + view.length, 0));
  const binary = Buffer.concat(views);
  const box = geometry.boundingBox!;
  const json = {
    asset: { version: "2.0", generator: "ParkMap scripts/motorcycle-model/build.ts" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "motorcycle", mesh: 0 }],
    meshes: [{ name: "motorcycle", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: "neutral", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: position.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: normal.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: color.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: index.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: "VEC3", min: box.min.toArray(), max: box.max.toArray() },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: vertexCount, type: "VEC3" },
      { bufferView: 3, componentType: index instanceof Uint16Array ? 5123 : 5125, count: index.length, type: "SCALAR" },
    ],
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonChunk.length + 8 + binary.length;
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = (data: Buffer, type: number) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  return Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binary, 0x004e4942)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = fileURLToPath(new URL("../../public/models/motorcycle.glb", import.meta.url));
  const glb = toGlb(motorcycleGeometry());
  writeFileSync(output, glb);
  console.log(`Wrote ${output} (${glb.length} bytes)`);
}
