import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeParkingSegmentation } from './detection.ts';
import { proxyAnnotationRequest } from './annotationProxy.ts';

void test('Analyze uses segmentation as primary without sending a classifier', async t => {
  const image = new File(['image-data'], 'frame.png', { type: 'image/png' });
  const controller = new AbortController();
  const payload = { detection: { detections: [] }, classification: null, classification_error: 'Model missing' };
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/classifier?op=analyze');
    assert.equal(options.signal, controller.signal);
    const body = options.body as FormData;
    assert.equal(body.get('model_id'), null);
    assert.equal(body.get('primary_detector'), 'segmentation');
    assert.equal(body.get('include_parking'), 'false');
    assert.equal(body.get('include_segmentation'), 'true');
    assert.equal(body.get('include_segmentation_gaps'), 'true');
    assert.equal(body.get('incoming_width_m'), '1.2');
    assert.equal(body.get('clearance_margin_m'), '0.1');
    assert.equal(await (body.get('image') as File).text(), 'image-data');
    return Response.json(payload);
  });
  assert.deepEqual(await analyzeParkingSegmentation(image, controller.signal, false, 1.2, .1), payload);
});

void test('Analyze preserves upstream failure messages', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'YOLO unavailable' }, { status: 503 }));
  await assert.rejects(analyzeParkingSegmentation(new File(['x'], 'x.png')), /YOLO unavailable/);
});

void test('combined Analyze proxy preserves multipart data and server-only authorization', async () => {
  const body = new FormData();
  body.set('image', new File(['pixels'], 'x.png', { type: 'image/png' }));
  body.set('primary_detector', 'segmentation');
  const response = await proxyAnnotationRequest(new Request('http://127.0.0.1:3000/api/classifier?op=analyze', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:3000' }, body,
  }), { apiUrl: 'http://127.0.0.1:8000', token: 'test-operator', fetcher: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/api/operator/classifier/analyze');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-operator');
    assert.equal((await new Request(url, options).formData()).get('primary_detector'), 'segmentation');
    return Response.json({ detection: {} });
  } });
  assert.equal(response.status, 200);
});
