import assert from "node:assert/strict";
import { test } from "node:test";
import { dragOffset, project, restsOpen, rubberband } from "./sheet.ts";

test("a fling projects further the faster it is, in its own direction", () => {
  assert.equal(project(0), 0);
  assert.ok(project(1000) > project(500));
  assert.equal(project(-800), -project(800));
});

test("a drag past a rest gives way less and less", () => {
  assert.equal(rubberband(0, 400), 0);
  assert.ok(rubberband(100, 400) < 100);
  assert.ok(rubberband(200, 400) - rubberband(100, 400) < rubberband(100, 400));
  assert.equal(dragOffset(120, 300, 400), 120);
  assert.ok(dragOffset(-50, 300, 400) > -50 && dragOffset(-50, 300, 400) < 0);
  assert.ok(dragOffset(350, 300, 400) > 300 && dragOffset(350, 300, 400) < 350);
});

test("a release rests at the rest nearest where its momentum carries it", () => {
  // Slow releases go to the nearer rest.
  assert.equal(restsOpen(100, 0, 300), true);
  assert.equal(restsOpen(200, 0, 300), false);
  // A quick flick wins over position.
  assert.equal(restsOpen(250, -600, 300), true);
  assert.equal(restsOpen(40, 600, 300), false);
});
