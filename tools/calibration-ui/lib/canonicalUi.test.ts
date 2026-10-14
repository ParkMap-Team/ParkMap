import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../components/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
const analyzer = readFileSync(new URL('../components/camera/ImageAnalyzer.tsx', import.meta.url), 'utf8');
const camera = readFileSync(new URL('../components/camera/CameraMonitor.tsx', import.meta.url), 'utf8');
const physicalMap = readFileSync(new URL('../components/parking/PhysicalMeasuredMap.tsx', import.meta.url), 'utf8');

void test('product exposes only Parking and Setup areas', () => {
  assert.match(dashboard, />Parking</);
  assert.match(dashboard, />Setup</);
  assert.doesNotMatch(dashboard, /Advanced|Hybrid|ROI Spatial|mapView|rowDisplayOrder/);
});

void test('legacy experimental controls do not return', () => {
  const source = `${dashboard}\n${analyzer}\n${camera}`;
  assert.doesNotMatch(source, /Ground Proxy|FIT_CANDIDATE|Occupied intervals|Row projection|Advanced diagnostics|map selector/i);
});

void test('detection image iterates every YOLO detection', () => {
  assert.match(camera, /analysis\.detections\.map/);
});

void test('physical parking map loads before an image is selected', () => {
  const calibrationEffect = analyzer.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/);

  assert.ok(calibrationEffect, 'ImageAnalyzer should load the saved parking map in an effect');
  assert.doesNotMatch(calibrationEffect[1], /if \(!file\) return/);
  assert.equal(calibrationEffect[2].trim(), '');
});

void test('physical map draws configured parking area before motorcycle footprints', () => {
  const parkingAreaLayer = physicalMap.indexOf('data-parking-layer="configured-area"');
  const motorcycleLayer = physicalMap.indexOf('data-parking-layer="motorcycle-footprint"');

  assert.notEqual(parkingAreaLayer, -1, 'configured parking area should have a visible base layer');
  assert.notEqual(motorcycleLayer, -1, 'motorcycle footprints should have their own overlay layer');
  assert.ok(parkingAreaLayer < motorcycleLayer, 'motorcycles should render above the configured parking area');
  assert.match(physicalMap, /Configured parking area/);
});
