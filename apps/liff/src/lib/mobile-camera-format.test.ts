import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesCameraAspect, openMatchingCamera } from './mobile-camera-format.ts';

void test('accepts proportional resolution but rejects portrait and widescreen without cropping', () => {
  assert.equal(matchesCameraAspect(1920, 1440, 4032, 3024), true);
  assert.equal(matchesCameraAspect(1920, 1080, 4032, 3024), false);
  assert.equal(matchesCameraAspect(1080, 1440, 4032, 3024), false);
});

void test('requests exact aspect and falls back only for unsupported constraints', async () => {
  const calls: MediaStreamConstraints[] = [];
  const stream = {} as MediaStream;
  assert.equal(await openMatchingCamera({ getUserMedia: async constraints => {
    calls.push(constraints!);
    if (calls.length === 1) throw new DOMException('unsupported', 'OverconstrainedError');
    return stream;
  } }, 4032, 3024), stream);
  assert.deepEqual((calls[0].video as MediaTrackConstraints).aspectRatio, { exact: 4 / 3 });
  assert.deepEqual((calls[1].video as MediaTrackConstraints).aspectRatio, { ideal: 4 / 3 });
});
