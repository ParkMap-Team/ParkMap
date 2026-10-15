import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MOTORCYCLE_MODEL } from "./motorcycle-model.ts";

// The committed model must match what the map assumes: one mesh, length along +X, centred in X
// and Z, wheels on the ground, metres, and no external or compressed resources to fetch.

const glb = readFileSync(new URL("../../../public/models/motorcycle.glb", import.meta.url));

function gltf() {
  assert.equal(glb.readUInt32LE(0), 0x46546c67, "glTF magic");
  assert.equal(glb.readUInt32LE(4), 2, "glTF version");
  assert.equal(glb.readUInt32LE(8), glb.length, "declared length");
  const length = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a, "JSON chunk");
  return JSON.parse(glb.subarray(20, 20 + length).toString());
}

test("the motorcycle model is a self-contained glTF binary", () => {
  const json = gltf();
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.extensionsUsed, undefined);
  assert.ok(json.buffers.every((buffer: { uri?: string }) => buffer.uri === undefined));
  assert.equal(json.images, undefined);
  assert.equal(json.meshes.length, 1);
  assert.ok(glb.length < 200_000, "small enough for a phone");
});

test("the motorcycle model's axes, origin, and ground contact match the map", () => {
  const json = gltf();
  const primitive = json.meshes[0].primitives[0];
  assert.ok(primitive.attributes.COLOR_0 !== undefined, "vertex colours, no textures");
  const { min, max } = json.accessors[primitive.attributes.POSITION];
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  assert.ok(close(max[0] - min[0], MOTORCYCLE_MODEL.lengthM), "length along X");
  assert.ok(close(max[2] - min[2], MOTORCYCLE_MODEL.widthM), "width along Z");
  assert.ok(close(max[1] - min[1], MOTORCYCLE_MODEL.heightM), "height along Y");
  assert.ok(MOTORCYCLE_MODEL.lengthM > MOTORCYCLE_MODEL.widthM * 2, "long axis is X");
  assert.ok(close(min[0] + max[0], 0) && close(min[2] + max[2], 0), "centred in X and Z");
  assert.ok(close(min[1], 0), "wheels touch the ground");
  assert.equal(json.nodes[0].matrix ?? json.nodes[0].rotation ?? json.nodes[0].scale, undefined, "no node transform");
});
