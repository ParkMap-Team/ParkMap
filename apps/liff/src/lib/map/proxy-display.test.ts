import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveRegion, MotorcycleProxy } from '../api/types.ts';
import { fitProxyDisplay } from './proxy-display.ts';
import { pointInPolygon, proxyFootprint } from './geometry.ts';

const proxy: MotorcycleProxy = { detection_id: 'd1', center: { x_m: .5, y_m: .2 }, heading_rad: Math.PI / 2, length_m: 2, width_m: .66, confidence: .9, display_scale: 1 };
const band: LiveRegion = { kind: 'OCCUPIED', detection_id: 'd1', polygon: [[{ x_m: 0, y_m: 0 }, { x_m: 1, y_m: 0 }, { x_m: 1, y_m: 1.4 }, { x_m: 0, y_m: 1.4 }]] };
/** The motorcycle's width lies inside the band along the stretch of it the band is long enough to hold. */
function widthInside(display: MotorcycleProxy, polygon: LiveRegion['polygon']) {
  return proxyFootprint({ ...display, length_m: 1.2 })[0].every(p => pointInPolygon(p, polygon));
}
test('display fits inside occupied band without mutating source dimensions or position', () => {
  const before = structuredClone(proxy);
  const display = fitProxyDisplay(proxy, [band]);
  assert.deepEqual(display.center, { x_m: .5, y_m: .7 });
  assert.ok(widthInside(display, band.polygon));
  assert.deepEqual(proxy, before);
});
test('a narrow band narrows the motorcycle but never shortens it, even when the band is shorter', () => {
  const narrow: LiveRegion = { ...band, polygon: [[{ x_m: 0, y_m: 0 }, { x_m: .4, y_m: 0 }, { x_m: .4, y_m: 1.4 }, { x_m: 0, y_m: 1.4 }]] };
  const display = fitProxyDisplay(proxy, [narrow]);
  assert.equal(display.length_m, proxy.length_m);
  assert.ok(display.width_m < .4 && display.width_m > .3);
  assert.ok(widthInside(display, narrow.polygon));
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
  assert.ok(widthInside(display, clipped.polygon));
});
test('an icon cannot snap to another detection or an anonymous legacy band', () => {
  assert.equal(fitProxyDisplay(proxy, [{ ...band, detection_id: 'other' }]), proxy);
  assert.equal(fitProxyDisplay(proxy, [{ ...band, detection_id: null }]), proxy);
  const far = { ...proxy, center: { x_m: 20, y_m: 20 } };
  assert.ok(widthInside(fitProxyDisplay(far, [band]), band.polygon));
});
test('recentres a row icon whose original centre has drifted past the band edge', () => {
  const shifted = { ...proxy, center: { x_m: .5, y_m: -.4 } };
  const display = fitProxyDisplay(shifted, [band]);
  assert.notEqual(display, shifted);
  assert.ok(widthInside(display, band.polygon));
});
