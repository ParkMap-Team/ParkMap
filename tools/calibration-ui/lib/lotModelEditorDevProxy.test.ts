import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { lotModelEditorMiddleware } from './lotModelEditorDevProxy.ts';

void test('the local Node proxy forwards Unicode JSON without exposing its server credential', async () => {
  const body = JSON.stringify({ name: 'ทางเดินหน้าลาน' });
  const middleware = lotModelEditorMiddleware({
    apiUrl: 'http://127.0.0.1:8000', token: 'private-test-editor-token',
    fetcher: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:8000/api/operator/lot-model/validate');
      assert.equal(init.body, body);
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-test-editor-token');
      return Response.json({ valid: true });
    },
  });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}/api/lot-model-editor?op=validate`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { valid: true });
    assert.equal(response.headers.get('Authorization'), null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
