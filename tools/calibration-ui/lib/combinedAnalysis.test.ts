import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeParkingSegmentation, detectMotorcycleFrame } from './detection.ts';
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

void test('the Parking model selection reaches both image analysis and captured frames', async t => {
  const image = new File(['pixels'], 'capture.png', { type: 'image/png' });
  const signal = new AbortController().signal;
  const received: Array<{ url: string; model: FormDataEntryValue | null; mode: FormDataEntryValue | null }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    const form = request.body as FormData;
    const model = form.get(url.endsWith('detect-frame') ? 'detector' : 'segmentation_model');
    received.push({ url, model, mode: form.get('mode') });
    assert.equal(form.has('incoming_width_m'), false);
    return Response.json({ detections: [], mode: form.get('mode') ?? 'near', crop_padding_ratio: 0.05, max_selected_boxes: 60 });
  });
  await analyzeParkingSegmentation(image, signal, false, undefined, 0, 'yolo26n-seg');
  await detectMotorcycleFrame(image, 'yolo26n-seg', signal, 'wide');
  await detectMotorcycleFrame(image, 'yolo26n', signal);
  assert.deepEqual(received, [
    { url: '/api/classifier?op=analyze', model: 'yolo26n-seg', mode: null },
    { url: '/api/classifier?op=detect-frame', model: 'yolo26n-seg', mode: 'wide' },
    { url: '/api/classifier?op=detect-frame', model: 'yolo26n', mode: null },
  ]);
});

void test('frame detection reports an outdated API before using missing crop settings', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detections: [] }));
  const image = new File(['pixels'], 'capture.png', { type: 'image/png' });
  await assert.rejects(
    detectMotorcycleFrame(image, 'yolo26n', new AbortController().signal),
    /Vision API.*รีสตาร์ต/,
  );
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
