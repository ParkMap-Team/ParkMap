import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyAnnotationRequest } from './annotationProxy.ts';
const base = 'http://127.0.0.1:3000';
const options = { apiUrl: 'http://127.0.0.1:8000', token: 'server-only-test' };

void test('annotation proxy preserves multipart bytes and sends credentials only upstream', async () => {
  const body = new FormData(); body.set('image', new Blob([new Uint8Array([0, 255, 128])], { type: 'image/png' }), 'photo.png');
  const request = new Request(base + '/api/annotation?dataset=demo&op=upload', { method: 'POST', headers: { Origin: base }, body });
  const response = await proxyAnnotationRequest(request, { ...options, fetcher: async (url, init) => {
    assert.equal(url, options.apiUrl + '/api/operator/annotations/demo/images');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer server-only-test');
    const parsed = await new Request(url, init).formData();
    assert.deepEqual(new Uint8Array(await (parsed.get('image') as File).arrayBuffer()), new Uint8Array([0, 255, 128]));
    return Response.json({ id: 'image-id' });
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Authorization'), null);
});

void test('annotation proxy rejects cross-origin, path traversal, absent token and oversized writes', async () => {
  assert.equal((await proxyAnnotationRequest(new Request(base + '/api/annotation?dataset=demo&op=samples', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), options)).status, 403);
  assert.equal((await proxyAnnotationRequest(new Request(base + '/api/annotation?dataset=demo&op=export', { method: 'POST' }), options)).status, 403);
  assert.equal((await proxyAnnotationRequest(new Request(base + '/api/annotation?dataset=..&op=samples'), options)).status, 400);
  assert.equal((await proxyAnnotationRequest(new Request(base + '/api/annotation?dataset=demo&op=samples'), { apiUrl: options.apiUrl })).status, 503);
  assert.equal((await proxyAnnotationRequest(new Request(base + '/api/annotation?dataset=demo&op=upload', { method: 'POST', headers: {
    Origin: base, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(27 * 1024 * 1024),
  } }), options)).status, 413);
});
