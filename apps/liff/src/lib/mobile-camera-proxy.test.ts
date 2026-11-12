import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyMobileCamera } from './mobile-camera-proxy.ts';

void test('phone proxy carries only the phone capability and cannot reach operator routes', async () => {
  const response = await proxyMobileCamera(new Request('https://phone.example/api/mobile-camera?op=frame', {
    method: 'POST', headers: { Authorization: 'Bearer scoped-phone', 'Content-Type': 'image/jpeg', 'X-Frame-Sequence': '2', Cookie: 'private-cookie' }, body: 'pixels',
  }), { apiUrl: 'http://api.test', fetcher: async (url, init) => {
    assert.equal(url, 'http://api.test/api/mobile-camera/frame');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer scoped-phone');
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(new Headers(init?.headers).get('X-Frame-Sequence'), '2');
    return Response.json({ state: 'AWAITING_APPROVAL' });
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const forbidden = await proxyMobileCamera(new Request('https://phone.example/api/mobile-camera?op=../operator/calibration', { method: 'POST' }), { apiUrl: 'http://api.test' });
  assert.equal(forbidden.status, 405);
});

void test('phone proxy rejects large pairing bodies without forwarding', async () => {
  const response = await proxyMobileCamera(new Request('https://phone.example/api/mobile-camera?op=claim', {
    method: 'POST', body: 'x'.repeat(2049),
  }), { apiUrl: 'http://api.test', fetcher: async () => { throw new Error('must not forward'); } });
  assert.equal(response.status, 413);
});
