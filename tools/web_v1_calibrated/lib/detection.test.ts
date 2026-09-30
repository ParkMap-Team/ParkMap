import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeParkingImage } from './detection.ts';

void test('image analysis sends the upload and preserves YOLO results', async () => {
  const originalFetch = globalThis.fetch;
  const payload = {
    image_width: 1000,
    image_height: 800,
    model: { name: 'ParkMap YOLO', status: 'ready' },
    inference: { imgsz: 960, confidence_threshold: .25, nms_iou: .5, processing_time_ms: 12 },
    detections: [{ class_id: 0, class_name: 'motorcycle', confidence: .91, bbox: { x: .1, y: .2, width: .3, height: .4 } }],
  };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, 'POST');
    assert.ok(init?.body instanceof FormData);
    assert.ok(init.body.get('image') instanceof File);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await analyzeParkingImage(new File(['image'], 'parking.jpg', { type: 'image/jpeg' }));
    assert.deepEqual(result, payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('image analysis exposes backend validation errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Invalid image.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(() => analyzeParkingImage(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })), /Invalid image/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
