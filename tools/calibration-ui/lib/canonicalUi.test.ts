import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../components/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
const analyzer = readFileSync(new URL('../components/camera/ImageAnalyzer.tsx', import.meta.url), 'utf8');
const camera = readFileSync(new URL('../components/camera/CameraMonitor.tsx', import.meta.url), 'utf8');

void test('product exposes Parking, combined Setup and Label areas', () => {
  assert.match(dashboard, />Parking</);
  assert.match(dashboard, />Setup</);
  assert.match(dashboard, />Label</);
  const setup = readFileSync(new URL('../components/setup/SetupWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(setup, /LotModelEditor/);
  assert.match(setup, /SetupPage/);
  assert.doesNotMatch(dashboard, /Advanced|Hybrid|ROI Spatial|mapView|rowDisplayOrder/);
});

void test('legacy experimental controls do not return', () => {
  const source = `${dashboard}\n${analyzer}\n${camera}`;
  assert.doesNotMatch(source, /Ground Proxy|FIT_CANDIDATE|Occupied intervals|Row projection|Advanced diagnostics|map selector/i);
});

void test('detection image iterates every YOLO detection', () => {
  assert.match(camera, /analysis\.detections\.map/);
});
