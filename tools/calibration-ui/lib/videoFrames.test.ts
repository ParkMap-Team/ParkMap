import assert from 'node:assert/strict';
import test from 'node:test';
import { REVIEW_CONFIDENCE_PERCENT } from './parkingSettings.ts';
import { buildVideoFrameTimes, captureVideoFrame, cropFramePreviews, filterFrameDetections, frameCandidateScore, frameCandidateTimes, reviewFrameCrops } from './videoFrames.ts';

void test('frame previews render only the detection crops and release the decoded frame', async t => {
  const drawImage = t.mock.fn();
  const close = t.mock.fn();
  const source = { width: 1000, height: 500, close };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage }),
    toDataURL: () => `crop:${canvas.width}x${canvas.height}`,
  };
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  Object.assign(globalThis, { document: { createElement: () => canvas }, createImageBitmap: async () => source });
  try {
    const previews = await cropFramePreviews(new Blob(), [{ x: .125, y: .25, width: .375, height: .5 }], .05);
    assert.deepEqual(previews, ['crop:240x160']);
    assert.deepEqual(drawImage.mock.calls[0]?.arguments, [source, 106, 112, 413, 276, 0, 0, 240, 160]);
    assert.equal(close.mock.callCount(), 1);
  } finally {
    Object.assign(globalThis, { document: previousDocument, createImageBitmap: previousCreateImageBitmap });
  }
});

void test('automatic frame selection samples up to six times across the clip', () => {
  assert.deepEqual(frameCandidateTimes(0.6), [0.3]);
  assert.deepEqual(frameCandidateTimes(24), [2, 6, 10, 14, 18, 22]);
  assert.deepEqual(frameCandidateTimes(Infinity), []);
});

void test('frame selection favors one clear detection over many weak boxes', () => {
  const box = { x: 0, y: 0, width: 0.3, height: 0.4 };
  const score = (...confidences: number[]) => frameCandidateScore(confidences.map(confidence => ({ confidence, bbox: box })), 960, 720);
  assert.equal(score(), 0);
  assert.ok(score(0.84) > score(0.45, 0.42));
});

void test('frame selection can prefer a larger crop when detection scores are close', () => {
  const small = { confidence: 0.84, bbox: { x: 0, y: 0, width: 0.04, height: 0.05 } };
  const large = { confidence: 0.8, bbox: { x: 0, y: 0, width: 0.3, height: 0.4 } };
  assert.ok(frameCandidateScore([large], 960, 720) > frameCandidateScore([small], 960, 720));
});

void test('frame review starts at 70% and can show weaker detections when lowered', () => {
  const scores = [0.84, 0.70, 0.69, 0.50, 0.28];
  const detections = scores.map(confidence => ({ confidence }));
  assert.deepEqual(filterFrameDetections(detections, REVIEW_CONFIDENCE_PERCENT).map(item => item.confidence), [0.84, 0.70]);
  assert.deepEqual(filterFrameDetections(detections, 50).map(item => item.confidence), [0.84, 0.70, 0.69, 0.50]);
  assert.deepEqual(filterFrameDetections(detections, 0), detections);
});

void test('combined frame review gives same-numbered boxes distinct keys and filters across frames', () => {
  const groups = reviewFrameCrops([
    { id: 'first', previews: [{ confidence: 0.9 }, { confidence: 0.6 }] },
    { id: 'second', previews: [{ confidence: 0.7 }] },
  ], 70);
  assert.deepEqual(groups.map(({ frame, crops }) => [frame.id, crops.map(({ id, key }) => [id, key])]), [
    ['first', [[1, 'first:1']]],
    ['second', [[1, 'second:1']]],
  ]);
});

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
