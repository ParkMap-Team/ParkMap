import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DETECTION_COVERAGE_TOGGLES, toggleDetectionCoverage } from './detectionCoverage.ts';

void test('Detection Coverage toggles do not mutate Analyze data or prior toggle state', () => { const analyze = { detections: [{ bbox: { x: .1, y: .2, width: .3, height: .4 } }] }; const before = JSON.stringify(analyze); const state = { ...DEFAULT_DETECTION_COVERAGE_TOGGLES }; const next = toggleDetectionCoverage(state, 'ground_proxy'); assert.equal(JSON.stringify(analyze), before); assert.equal(state.ground_proxy, true); assert.equal(next.ground_proxy, false); });
