import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVideoFrameTimes, captureVideoFrame } from './videoFrames.ts';

void test('samples a video every five seconds without exceeding its duration', () => {
  assert.deepEqual(buildVideoFrameTimes(16), [0, 5, 10, 15]);
  assert.deepEqual(buildVideoFrameTimes(5), [0]);
});

void test('rejects invalid durations and intervals safely', () => {
  assert.deepEqual(buildVideoFrameTimes(0), []);
  assert.deepEqual(buildVideoFrameTimes(Number.NaN), []);
  assert.throws(() => buildVideoFrameTimes(30, 0), /positive/);
  assert.throws(() => buildVideoFrameTimes(3_601), /60 minutes/);
});

void test('names a captured frame using its time before asynchronous encoding', async (t) => {
  const video = { readyState: 2, videoWidth: 320, videoHeight: 180, currentTime: 1.2 };
  const drawImage = t.mock.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (done: (blob: Blob) => void) => {
      video.currentTime = 2.5;
      queueMicrotask(() => done(new Blob(['frame'], { type: 'image/jpeg' })));
    },
  };
  const previousDocument = globalThis.document;
  const previousMediaElement = globalThis.HTMLMediaElement;
  Object.assign(globalThis, {
    document: { createElement: () => canvas },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  });
  try {
    const frame = await captureVideoFrame(video as HTMLVideoElement);
    assert.equal(frame.name, 'frame-1.2s.jpg');
    assert.equal(frame.type, 'image/jpeg');
    assert.deepEqual(drawImage.mock.calls[0]?.arguments, [video, 0, 0, 320, 180]);
  } finally {
    Object.assign(globalThis, { document: previousDocument, HTMLMediaElement: previousMediaElement });
  }
});
