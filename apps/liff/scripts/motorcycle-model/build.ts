// Builds public/models/motorcycle.glb: a generic scooter made only from three.js primitives and
// shapes in this file, so the asset has no third-party source and copies no real model. Run from
// apps/liff:
//
//   node --experimental-strip-types scripts/motorcycle-model/build.ts
//
// Axes: length along +X (front), up along +Y, width along Z, metres. The model is centred on the
// origin in X and Z and stands on Y = 0, so the map scales it onto the API's standard footprint.
// The API resolves the long axis, not the direction, so the map may draw it facing either way.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// Shades, not hues: the map multiplies them by the status colour, so panels show that colour and
// tyres, seat, and trim read as darker parts of the same motorcycle.
const COLORS = {
  body: "#ffffff",
  tyre: "#2e2e2e",
  rim: "#b3b3b3",
  trim: "#737373",
  seat: "#4a4a4a",
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

/**
 * A side-profile panel drawn in X and Y and given thickness across Z, with rounded edges and
 * smooth shading. The bevel is inset, so the silhouette is exactly the drawn shape.
 */
function panel(draw: (shape: Shape) => void, halfWidth: number, bevel: number, color: keyof typeof COLORS, z = 0): Part {
  const shape = new Shape();
  draw(shape);
  const depth = 2 * (halfWidth - bevel);
  const extruded = new ExtrudeGeometry(shape, {
    depth,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
  });
  extruded.translate(0, 0, z - depth / 2);
  extruded.deleteAttribute("normal");
  extruded.deleteAttribute("uv");
  const geometry = mergeVertices(extruded);
  geometry.computeVertexNormals();
  return painted(geometry, color);
}

const WHEEL_RADIUS = 0.27;
const FRONT_X = 0.66;
const REAR_X = -0.62;

function wheel(x: number): Part[] {
  const tube = 0.065;
  const tyre = new TorusGeometry(WHEEL_RADIUS - tube, tube, 10, 28);
  tyre.translate(x, WHEEL_RADIUS, 0);
  const rim = new CylinderGeometry(WHEEL_RADIUS - tube - 0.01, WHEEL_RADIUS - tube - 0.01, 0.08, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(x, WHEEL_RADIUS, 0);
  const hub = new CylinderGeometry(0.05, 0.05, 0.12, 16);
  hub.rotateX(Math.PI / 2);
  hub.translate(x, WHEEL_RADIUS, 0);
  return [painted(tyre, "tyre"), painted(rim, "rim"), painted(hub, "trim")];
}

/** A fender: a band of arc over a wheel, from `from` to `to` radians measured from +X. */
function fender(x: number, from: number, to: number, halfWidth: number): Part {
  const inner = WHEEL_RADIUS + 0.03;
  const outer = inner + 0.035;
  return panel(
    (shape) => {
      shape.absarc(x, WHEEL_RADIUS, outer, from, to, false);
      shape.absarc(x, WHEEL_RADIUS, inner, to, from, true);
    },
    halfWidth,
    0.012,
    "body",
  );
}

/** A mirror on a stalk, one side of the handlebar. */
function mirror(side: 1 | -1): Part[] {
  const glass = new CylinderGeometry(0.055, 0.055, 0.025, 16);
  glass.scale(1.4, 1, 1);
  glass.rotateZ(Math.PI / 2 - 0.25);
  glass.translate(0.45, 1.27, side * 0.29);
  return [rod(new Vector3(0.52, 1.07, side * 0.22), new Vector3(0.46, 1.25, side * 0.28), 0.011, "trim"), painted(glass, "trim")];
}

export function motorcycleParts(): Part[] {
  const bar = (z0: number, z1: number) => [new Vector3(0.53, 1.07, z0), new Vector3(0.53, 1.07, z1)] as const;
  return [
    ...wheel(REAR_X),
    ...wheel(FRONT_X),
    fender(FRONT_X, Math.PI * 0.1, Math.PI * 0.62, 0.075),
    // Rear cowl: thin over the rear wheel, full height in front of it where it meets the floor.
    panel(
      (s) => {
        s.moveTo(-0.1, 0.26);
        s.lineTo(-0.1, 0.62);
        s.quadraticCurveTo(-0.12, 0.75, -0.26, 0.75);
        s.lineTo(-0.72, 0.77);
        s.quadraticCurveTo(-0.93, 0.78, -0.94, 0.64);
        s.lineTo(-0.88, 0.58);
        s.lineTo(-0.4, 0.6);
        s.quadraticCurveTo(-0.3, 0.6, -0.28, 0.48);
        s.lineTo(-0.28, 0.26);
        s.closePath();
      },
      0.17,
      0.045,
      "body",
    ),
    // Floorboard, with a dark mat on top.
    panel(
      (s) => {
        s.moveTo(-0.3, 0.2);
        s.lineTo(0.3, 0.2);
        s.lineTo(0.36, 0.3);
        s.lineTo(-0.3, 0.32);
        s.closePath();
      },
      0.18,
      0.02,
      "body",
    ),
    box(-0.12, 0.3, 0.315, 0.33, 0.15, "seat"),
    // Leg shield: a raked panel from the floor up to the handlebar, clear of the front wheel.
    panel(
      (s) => {
        s.moveTo(0.2, 0.22);
        s.lineTo(0.34, 0.22);
        s.quadraticCurveTo(0.46, 0.55, 0.58, 0.96);
        s.lineTo(0.43, 0.99);
        s.quadraticCurveTo(0.3, 0.6, 0.2, 0.22);
        s.closePath();
      },
      0.21,
      0.04,
      "body",
    ),
    // Two-step seat: rider, then a raised pillion.
    panel(
      (s) => {
        s.moveTo(-0.12, 0.74);
        s.quadraticCurveTo(-0.14, 0.85, -0.28, 0.85);
        s.lineTo(-0.48, 0.84);
        s.quadraticCurveTo(-0.58, 0.9, -0.7, 0.9);
        s.quadraticCurveTo(-0.81, 0.9, -0.81, 0.8);
        s.lineTo(-0.77, 0.76);
        s.closePath();
      },
      0.16,
      0.04,
      "seat",
    ),
    // Engine and swing arm on one side, exhaust on the other.
    // A drive case from the rear hub forward, beside the wheel.
    panel(
      (s) => {
        s.absarc(REAR_X, WHEEL_RADIUS, 0.09, Math.PI / 2, (Math.PI * 3) / 2, false);
        s.lineTo(-0.32, 0.2);
        s.quadraticCurveTo(-0.24, 0.22, -0.25, 0.3);
        s.quadraticCurveTo(-0.27, 0.38, -0.36, 0.38);
        s.closePath();
      },
      0.055,
      0.02,
      "trim",
      0.125,
    ),
    rod(new Vector3(-0.86, 0.36, -0.17), new Vector3(-0.42, 0.33, -0.17), 0.055, "trim"),
    // Fork and handlebar cover with its headlight face.
    rod(new Vector3(FRONT_X, WHEEL_RADIUS, 0.085), new Vector3(0.53, 0.92, 0.085), 0.024, "rim"),
    rod(new Vector3(FRONT_X, WHEEL_RADIUS, -0.085), new Vector3(0.53, 0.92, -0.085), 0.024, "rim"),
    panel(
      (s) => {
        s.moveTo(0.4, 0.95);
        s.lineTo(0.64, 0.95);
        s.quadraticCurveTo(0.73, 0.99, 0.68, 1.07);
        s.lineTo(0.43, 1.1);
        s.quadraticCurveTo(0.36, 1.03, 0.4, 0.95);
        s.closePath();
      },
      0.15,
      0.03,
      "body",
    ),
    box(0.66, 0.705, 0.98, 1.04, 0.07, "rim"),
    rod(...bar(-0.34, 0.34), 0.016, "trim"),
    rod(...bar(-0.34, -0.23), 0.024, "seat"),
    rod(...bar(0.23, 0.34), 0.024, "seat"),
    ...mirror(1),
    ...mirror(-1),
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
