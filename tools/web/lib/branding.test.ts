import assert from 'node:assert/strict';
import test from 'node:test';
import { PARKMAP_LOGO_PATH, shouldDisplayParkMapLogo } from './branding.ts';

void test('uses the documented public logo path', () => assert.equal(PARKMAP_LOGO_PATH, '/branding/parkmap-logo.png'));
void test('missing logo uses the safe text fallback', () => assert.equal(shouldDisplayParkMapLogo('missing'), false));
void test('logo is displayed only after a successful load', () => { assert.equal(shouldDisplayParkMapLogo('checking'), false); assert.equal(shouldDisplayParkMapLogo('loaded'), true); });
