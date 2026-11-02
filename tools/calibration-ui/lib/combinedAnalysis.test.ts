import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeParkingWithClassifier } from './detection.ts';
import { proxyAnnotationRequest } from './annotationProxy.ts';

void test('Analyze sends image, chosen classifier and parking flag through the private proxy', async t => {
  const image = new File(['image-data'], 'frame.png', { type: 'image/png' });
  const controller = new AbortController();
  const payload = { detection: { detections: [] }, classification: null, classification_error: 'Model missing' };
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/classifier?op=analyze');
    assert.equal(options.signal, controller.signal);
    const body = options.body as FormData;
    assert.equal(body.get('model_id'), 'efficientnet-run');
    assert.equal(body.get('include_parking'), 'false');
    assert.equal(await (body.get('image') as File).text(), 'image-data');
    return Response.json(payload);
  });
  assert.deepEqual(await analyzeParkingWithClassifier(image, 'efficientnet-run', controller.signal, false), payload);
});

void test('Analyze preserves upstream failure messages', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'YOLO unavailable' }, { status: 503 }));
  await assert.rejects(analyzeParkingWithClassifier(new File(['x'], 'x.png'), ''), /YOLO unavailable/);
});

void test('combined Analyze proxy preserves multipart data and server-only authorization', async () => {
  const body = new FormData();
  body.set('image', new File(['pixels'], 'x.png', { type: 'image/png' }));
  body.set('model_id', 'selected-model');
  const response = await proxyAnnotationRequest(new Request('http://127.0.0.1:3000/api/classifier?op=analyze', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:3000' }, body,
  }), { apiUrl: 'http://127.0.0.1:8000', token: 'test-operator', fetcher: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/api/operator/classifier/analyze');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-operator');
    assert.equal((await new Request(url, options).formData()).get('model_id'), 'selected-model');
    return Response.json({ detection: {} });
  } });
  assert.equal(response.status, 200);
});
