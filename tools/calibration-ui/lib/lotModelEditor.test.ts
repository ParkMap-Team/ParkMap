import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { insertVertex, modelBounds, moveLandmark, moveVertex, newLandmark, rectangleDimensions, removeVertex, resizeRectangle, roiObjects, replaceEditorObject, rotatePolygonObject, adoptRoiOutline } from './lotModelEditor.ts';
import type { LotLandmark, LotModelDefinition } from '../types/lotModel.ts';

const walkway: LotLandmark = {
  landmark_id: 'walkway', kind: 'WALKWAY', position: { x_m: 1, y_m: 5 },
  polygon: [[{ x_m: 0, y_m: 0 }, { x_m: 2, y_m: 0 }, { x_m: 2, y_m: 10 }, { x_m: 0, y_m: 10 }]],
  measurement_source: 'ESTIMATED',
};

void test('operator can adopt the sole rotated ROI as the lot outline without moving landmarks', () => {
  const source = JSON.parse(readFileSync(new URL('../../../apps/vision-api/fixtures/spu-cam-01-lot-model.json', import.meta.url), 'utf8')) as LotModelDefinition;
  const roi = rotatePolygonObject(roiObjects(source)[0], 90);
  const edited = replaceEditorObject(source, roi);
  const adjusted = adoptRoiOutline(edited, roi.landmark_id);
  assert.deepEqual(adjusted.outline, roi.polygon);
  assert.deepEqual(adjusted.parking_areas, edited.parking_areas);
  assert.deepEqual(adjusted.landmarks, source.landmarks);
  assert.notDeepEqual(source.outline, adjusted.outline);
  assert.throws(() => adoptRoiOutline({ ...edited, parking_areas: [...edited.parking_areas, { ...edited.parking_areas[0], parking_area_id: 'other' }] }, roi.landmark_id));
});

void test('ROI rotation keeps holes and identity and changes only the selected parking polygon', () => {
  const model: LotModelDefinition = { schema_version: 1, outline: walkway.polygon!, landmarks: [walkway], parking_areas: [
    { parking_area_id: 'test-area', polygon: [...walkway.polygon!, [{ x_m: 0.5, y_m: 1 }, { x_m: 1, y_m: 1 }, { x_m: 1, y_m: 2 }]] },
  ] };
  const object = roiObjects(model)[0];
  const rotated = rotatePolygonObject(object, 90);
  const result = replaceEditorObject(model, rotated);
  const first = result.parking_areas[0].polygon[0][0];
  assert.ok(Math.abs(first.x_m - 6) < 1e-8);
  assert.ok(Math.abs(first.y_m - 4) < 1e-8);
  assert.equal(result.parking_areas[0].polygon.length, 2);
  assert.equal(result.parking_areas[0].parking_area_id, 'test-area');
  assert.deepEqual(result.outline, model.outline);
  assert.deepEqual(result.landmarks, model.landmarks);
  assert.deepEqual(replaceEditorObject(result, rotatePolygonObject(rotated, 0)), result);
  assert.deepEqual(model.parking_areas[0].polygon[0][0], { x_m: 0, y_m: 0 });
});

void test('width and length in metres produce a rotated rectangle around its existing centre', () => {
  const result = resizeRectangle(walkway, 4, 6, 90);
  const expected = [[4, 3], [4, 7], [-2, 7], [-2, 3]];
  result.polygon![0].forEach((point, index) => {
    assert.ok(Math.abs(point.x_m - expected[index][0]) < 1e-8);
    assert.ok(Math.abs(point.y_m - expected[index][1]) < 1e-8);
  });
  assert.deepEqual(result.position, walkway.position);
  assert.equal(result.measurement_source, 'ESTIMATED');
  assert.equal(rectangleDimensions(result)?.width, 4);
  assert.equal(rectangleDimensions(result)?.length, 6);
  assert.deepEqual(walkway.polygon![0][0], { x_m: 0, y_m: 0 });
});

void test('moving a landmark translates its anchor, outer ring and holes without losing metadata', () => {
  const original: LotLandmark = {
    ...walkway, name: 'ทางเดิน', polygon: [...walkway.polygon!, [{ x_m: 0.5, y_m: 1 }, { x_m: 1, y_m: 1 }, { x_m: 1, y_m: 2 }]],
  };
  const moved = moveLandmark(original, { x_m: 4, y_m: 3 });
  assert.deepEqual(moved.position, { x_m: 4, y_m: 3 });
  assert.deepEqual(moved.polygon![0][0], { x_m: 3, y_m: -2 });
  assert.deepEqual(moved.polygon![1][0], { x_m: 3.5, y_m: -1 });
  assert.equal(moved.name, 'ทางเดิน');
  assert.deepEqual(original.polygon![0][0], { x_m: 0, y_m: 0 });
});

void test('irregular polygons and holes are preserved and cannot be resized as rectangles', () => {
  const polygon: LotLandmark = { ...walkway, polygon: [[{ x_m: 0, y_m: 0 }, { x_m: 3, y_m: 0 }, { x_m: 2, y_m: 5 }, { x_m: 0, y_m: 4 }]] };
  assert.equal(rectangleDimensions(polygon), null);
  assert.throws(() => resizeRectangle(polygon, 4, 5, 0));
  const edited = moveVertex(polygon, 0, 2, { x_m: 2, y_m: 6 });
  assert.deepEqual(edited.polygon![0][2], { x_m: 2, y_m: 6 });
  assert.deepEqual(edited.polygon![0][3], polygon.polygon![0][3]);
  assert.deepEqual(edited.position, polygon.position);
});

void test('closed rings keep their closure when a vertex is moved', () => {
  const closed: LotLandmark = { ...walkway, polygon: [[...walkway.polygon![0], { ...walkway.polygon![0][0] }]] };
  const edited = moveVertex(closed, 0, 0, { x_m: -1, y_m: -2 });
  assert.deepEqual(edited.polygon![0][0], edited.polygon![0][4]);
  assert.equal(edited.polygon![0].length, 5);
});

void test('adding and removing corners supports free-form roads while keeping a valid ring', () => {
  const inserted = insertVertex(walkway, 0, 1);
  assert.equal(inserted.polygon![0].length, 5);
  assert.deepEqual(inserted.polygon![0][2], { x_m: 2, y_m: 5 });
  assert.deepEqual(removeVertex(inserted, 0, 2).polygon, walkway.polygon);
  const triangle = removeVertex(walkway, 0, 1);
  assert.throws(() => removeVertex(triangle, 0, 0));
  assert.deepEqual(walkway.polygon![0][0], { x_m: 0, y_m: 0 });
});

void test('inspecting the starting fixture preserves its data and new objects have unique estimated IDs', () => {
  const model = JSON.parse(readFileSync(new URL('../../../apps/vision-api/fixtures/spu-cam-01-lot-model.json', import.meta.url), 'utf8')) as LotModelDefinition;
  const before = JSON.stringify(model);
  const bounds = modelBounds(model);
  assert.ok(bounds.minX < bounds.maxX && bounds.minY < bounds.maxY);
  model.landmarks!.forEach(rectangleDimensions);
  assert.equal(JSON.stringify(model), before);
  const first = newLandmark(model, 'TREE', { x_m: 0, y_m: 0 });
  const second = newLandmark({ ...model, landmarks: [...model.landmarks!, first] }, 'TREE', { x_m: 1, y_m: 1 });
  assert.notEqual(first.landmark_id, second.landmark_id);
  assert.equal(first.measurement_source, 'ESTIMATED');
  assert.ok(first.radius_m! > 0 && first.height_m! >= first.radius_m!);
  assert.equal(JSON.stringify(model), before);
});
