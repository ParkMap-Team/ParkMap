// Opt-in local browser smoke test. Uses a generated grey camera, never approves
// publication, and always revokes its pairing session. No public tunnel required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const operator = process.argv[2] ?? 'http://127.0.0.1:3000';
const phone = process.argv[3] ?? 'http://127.0.0.1:3001';
const temp = await mkdtemp(join(tmpdir(), 'parkmap-phone-browser-'));
const capture = join(temp, 'camera.y4m');
await writeFile(capture, Buffer.concat([Buffer.from('YUV4MPEG2 W640 H480 F30:1 Ip A1:1 C420jpeg\nFRAME\n'), Buffer.alloc(640*480*3/2, 128)]));
const listener = createServer();
await new Promise(done => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const child = spawn(process.env.PARKMAP_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless', '--disable-gpu', '--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${capture}`, '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let socket, serial = 0, session;
const diagnostics = [];
const network = new Map();
const pending = new Map();
const pause = ms => new Promise(done => setTimeout(done, ms));
function call(method, params = {}) {
  return new Promise((done, fail) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); fail(Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, 'Browser expression failed');
  return result.result.value;
}
async function until(expression, timeout = 45000) {
  const end = Date.now()+timeout;
  while (Date.now()<end) { if (await evaluate(expression)) return; await pause(200); }
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  const path = join(temp, 'mobile-camera-debug.png');
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  console.log('Browser diagnostic screenshot:', path);
  console.log(await evaluate(`JSON.stringify({pathname:location.pathname,hashPresent:!!location.hash,hasButton:!!document.querySelector('[data-mobile-start]'),hydrated:Object.keys(document.querySelector('[data-mobile-start]')??{}).some(k=>k.startsWith('__reactProps')),disabled:document.querySelector('[data-mobile-start]')?.disabled,state:document.querySelector('[data-mobile-state]')?.dataset.mobileState})`));
  console.log('Browser errors:', diagnostics.slice(-10));
  console.log('Pending resources:', [...network.values()].slice(-12));
  console.log('Page scripts:', await evaluate(`JSON.stringify([...document.scripts].map(s=>({src:s.src?new URL(s.src).pathname:'inline',type:s.type})).slice(0,12))`));
  throw Error('Mobile browser condition timed out');
}
try {
  const created = await fetch(`${operator}/api/lot-model-editor?op=mobile-create`, { method: 'POST',
    headers: { Origin: operator, 'Content-Type': 'application/json' }, body: JSON.stringify({ parking_area_id: 'sripatum-near-lot', mobile_origin: 'https://example.test' }) });
  assert.ok(created.ok, 'Local pairing creation failed');
  const data = await created.json(); session = data.session_id;
  assert.ok(data.qr_svg.includes('<svg'));
  let page;
  for (let n=0; n<100; n++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page'); } catch { /* Starting */ }
    if (page) break; await pause(100);
  }
  assert.ok(page, 'Browser unavailable');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen=done; socket.onerror=fail; });
  socket.onmessage = event => {
    const value=JSON.parse(event.data), entry=pending.get(value.id);
    if(value.method === 'Runtime.exceptionThrown') diagnostics.push((value.params.exceptionDetails.exception?.description ?? value.params.exceptionDetails.text).slice(0,350).replace(/[A-Za-z0-9_-]{35,}/g,'[redacted]'));
    if(value.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(value.params.type)) diagnostics.push(value.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,500).replace(/[A-Za-z0-9_-]{35,}/g,'[redacted]'));
    if(value.method === 'Log.entryAdded') diagnostics.push(value.params.entry.text.slice(0,350).replace(/[A-Za-z0-9_-]{35,}/g,'[redacted]'));
    if(value.method === 'Network.requestWillBeSent') { try { network.set(value.params.requestId,new URL(value.params.request.url).pathname); } catch {} }
    if(value.method === 'Network.loadingFinished') network.delete(value.params.requestId);
    if(value.method === 'Network.loadingFailed') { diagnostics.push(`${value.params.errorText} ${network.get(value.params.requestId)??''}`);network.delete(value.params.requestId); }
    if(value.method === 'Network.responseReceived' && value.params.response.status>=400) diagnostics.push(`${value.params.response.status} ${new URL(value.params.response.url).pathname}`);
    if (!entry) return; pending.delete(value.id); clearTimeout(entry.timer);
    if (value.error) entry.fail(Error(value.error.message)); else entry.done(value.result);
  };
  await call('Runtime.enable'); await call('Network.enable'); await call('Log.enable');
  const fragment = new URL(data.join_url).hash;
  await call('Page.navigate', { url: `${phone}/mobile-camera${fragment}` });
  await until(`document.querySelector('[data-mobile-start]') && !document.querySelector('[data-mobile-start]').disabled`);
  await evaluate(`document.querySelector('[data-mobile-start]').click()`);
  await until(`document.querySelector('[data-mobile-state]')?.dataset.mobileState === 'AWAITING_APPROVAL'`);
  assert.equal(await evaluate('location.hash'), '', 'Pair capability must leave the address bar');
  assert.ok(await evaluate('document.querySelector("video").videoWidth > 0'));
  const reviewed = await (await fetch(`${operator}/api/lot-model-editor?op=mobile-status&session=${session}`)).json();
  assert.ok(reviewed.preview_url?.startsWith('data:image/jpeg'));
  assert.equal(reviewed.state, 'AWAITING_APPROVAL');
  assert.equal(reviewed.result, null, 'Fake frames must never publish to LIFF');
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  const path=join(temp, 'mobile-camera.png'); await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  console.log(`Screenshot: ${path}`);
  await evaluate(`document.querySelector('[data-mobile-stop]').click()`);
  await until(`document.querySelector('[data-mobile-state]')?.dataset.mobileState === 'STOPPED'`);
  assert.ok(await evaluate('document.querySelector("video").srcObject.getTracks().every(t=>t.readyState==="ended")'));
  console.log('PASS: local QR pairing, fake camera permission, serial preview upload, desktop approval gate, token fragment cleanup and camera stop. No state was published.');
} finally {
  if (session) await fetch(`${operator}/api/lot-model-editor?op=mobile-stop&session=${session}`, { method: 'POST', headers: { Origin: operator, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  socket?.close(); child.kill();
}
