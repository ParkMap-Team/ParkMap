import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveRegion, MotorcycleProxy } from '../api/types.ts';
import { fitProxyDisplay } from './proxy-display.ts';
import { pointInPolygon, proxyFootprint } from './geometry.ts';

const proxy: MotorcycleProxy = { detection_id: 'd1', center: { x_m: .5, y_m: .2 }, heading_rad: Math.PI / 2, length_m: 2, width_m: .66, confidence: .9, display_scale: 1 };
const band: LiveRegion = { kind: 'OCCUPIED', detection_id: 'd1', polygon: [[{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }, { x_m: 1, y_m: 1.4 }, { x_m: 0, y_m: 1.4 }]] };
test('display fits inside occupied band without mutating source dimensions or position', () => {
  const before = structuredClone(proxy);
  const display = fitProxyDisplay(proxy, [band]);
  assert.deepEqual(display.center, { x_m: .5, y_m: .7 });
  assert.ok(proxyFootprint(display)[0].every(p => pointInPolygon(p, band.polygon)));
  assert.ok(display.length_m < proxy.length_m);
  assert.deepEqual(proxy, before);
});
test('crosswise and unmatched motorcycles retain their observed pose', () => {
  const horizontal = { ...proxy, heading_rad: 0 };
  assert.equal(fitProxyDisplay(horizontal, [band]), horizontal);
  assert.equal(fitProxyDisplay(proxy, []), proxy);
  assert.equal(fitProxyDisplay(proxy, [{ ...band, kind: 'UNKNOWN' }]), proxy);
});
test('fits bands clipped into extra vertices and explicitly closed rings', () => {
  const clipped: LiveRegion = { kind: 'OCCUPIED', detection_id: 'd1', polygon: [[
    { x_m: 0, y_m: 0 }, { x_m: .8, y_m: 0 }, { x_m: 1, y_m: .2 },
    { x_m: 1, y_m: 1.4 }, { x_m: 0, y_m: 1.4 }, { x_m: 0, y_m: 0 },
  ]] };
  const display = fitProxyDisplay(proxy, [clipped]);
  assert.notEqual(display, proxy);
  assert.ok(proxyFootprint(display)[0].every(p => pointInPolygon(p, clipped.polygon)));
});
test('an icon cannot snap to another detection or an anonymous legacy band', () => {
  assert.equal(fitProxyDisplay(proxy, [{ ...band, detection_id: 'other' }]), proxy);
  assert.equal(fitProxyDisplay(proxy, [{ ...band, detection_id: null }]), proxy);
  const far = { ...proxy, center: { x_m: 20, y_m: 20 } };
  assert.ok(proxyFootprint(fitProxyDisplay(far, [band]))[0].every(p => pointInPolygon(p, band.polygon)));
});
test('recentres a row icon whose original centre has drifted past the band edge', () => {
  const shifted = { ...proxy, center: { x_m: .5, y_m: -.4 } };
  const display = fitProxyDisplay(shifted, [band]);
  assert.notEqual(display, shifted);
  assert.ok(proxyFootprint(display)[0].every(p => pointInPolygon(p, band.polygon)));
});
