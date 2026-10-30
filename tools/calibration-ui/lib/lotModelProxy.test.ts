import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyLotModelRequest } from './lotModelProxy.ts';
import { GET, POST, PUT } from '../app/api/lot-model-editor/route.ts';

void test('the local editor forwards a same-origin request using a server-only token', async () => {
  let forwarded = '';
  const response = await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=validate', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: '{"schema_version":1}',
  }), {
    apiUrl: 'http://127.0.0.1:8000', token: 'server-only-editor-token',
    fetcher: async (url, init) => {
      forwarded = url;
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer server-only-editor-token');
      assert.equal(init.body, '{"schema_version":1}');
      return Response.json({ valid: true }, { headers: { 'Set-Cookie': 'private=value' } });
    },
  });
  assert.equal(forwarded, 'http://127.0.0.1:8000/api/operator/lot-model/validate');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /server-only-editor-token/);
});

for (const origin of ['https://untrusted.example', 'null', '']) {
  void test(`editor rejects cross-origin or missing-origin writes (${origin || 'missing'})`, async () => {
    let calls = 0;
    const response = await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=validate', {
      method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: '{}',
    }), { apiUrl: 'http://127.0.0.1:8000', token: 'private', fetcher: async () => { calls++; return Response.json({}); } });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });
}

void test('editor proxy is disabled without a token and cannot proxy arbitrary sites or methods', async () => {
  const options = { apiUrl: 'http://127.0.0.1:8000', token: 'private', fetcher: async () => { throw new Error('Must not call API'); } };
  assert.equal((await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=template'), { ...options, token: '' })).status, 503);
  assert.equal((await proxyLotModelRequest(new Request('http://public.example/api/lot-model-editor?op=template'), options)).status, 403);
  assert.equal((await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=draft&site=../../other'), options)).status, 400);
  assert.equal((await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=activate&site=sripatum'), options)).status, 405);
});

void test('editor rejects oversized bodies before forwarding them', async () => {
  let calls = 0;
  const response = await proxyLotModelRequest(new Request('http://localhost:3000/api/lot-model-editor?op=validate', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: ' '.repeat(1024 * 1024 + 1),
  }), { apiUrl: 'http://127.0.0.1:8000', token: 'private', fetcher: async () => { calls++; return Response.json({}); } });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

void test('the built deployment route always fails closed instead of proxying an operator secret', () => {
  for (const handler of [GET, POST, PUT]) {
    const response = handler();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
