// Opt-in real-browser smoke test. Requires local API/UI, YOLO and completed classifiers.
// No model training, dataset writes, or intercepted inference responses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const image = resolve(process.argv[3] ?? '../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg');
const targetArchitecture = process.argv[4];
const temp = await mkdtemp(join(tmpdir(), 'parkmap-classifier-browser-'));
const listener = createServer();
await new Promise(done => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const child = spawn(process.env.PARKMAP_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, serial = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((done, fail) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); fail(Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { done, fail, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (answer.exceptionDetails) throw Error(JSON.stringify(answer.exceptionDetails));
  return answer.result.value;
}
async function wait(expression, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(expression)) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw Error(`Page condition timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-2500)')}`);
}
try {
  let page;
  for (let n = 0; n < 100; n++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page'); } catch { /* Browser starting. */ }
    if (page) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(page);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = event => {
    const value = JSON.parse(event.data), entry = pending.get(value.id);
    if (!entry) return;
    pending.delete(value.id); clearTimeout(entry.timer);
    if (value.error) entry.fail(Error(JSON.stringify(value.error))); else entry.done(value.result);
  };
  await call('Page.navigate', { url: base });
  await wait(`Boolean(document.querySelector('section[aria-label="จำแนกรุ่นรถทดลอง"]'))`, 60000);
  await wait(`Object.keys(document.querySelector('input[type=file]')).some(k=>k.startsWith('__reactProps'))`);
  await call('DOM.enable');
  const doc = await call('DOM.getDocument');
  const input = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [image] });
  await wait(`document.body.innerText.includes(${JSON.stringify(image.split(/[\\/]/).at(-1))})`);
  await wait(`document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]')?.options.length >= 3`);
  if (targetArchitecture) {
    await wait(`[...document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]').options].some(o=>o.textContent.includes(${JSON.stringify(targetArchitecture)}))`);
    await evaluate(`var target=document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]');target.value=[...target.options].find(o=>o.textContent.includes(${JSON.stringify(targetArchitecture)})).value;target.dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.ok((await evaluate(`document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]').selectedOptions[0].textContent`)).includes(targetArchitecture));
  }
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze').click()`);
  await wait(`Boolean(document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]'))`, 120000);
  assert.equal(await evaluate(`document.querySelectorAll('section[aria-label="จำแนกรุ่นรถทดลอง"] ol li').length`), 3);
  assert.equal(await evaluate(`document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]').naturalWidth>0`), true);
  assert.match(await evaluate(`document.querySelector('[aria-label="ขนาดอ้างอิงของรถ"]').textContent`), /0\.66.*2\.00/);
  assert.equal(await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').checked`), true);
  await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').click()`);
  await wait(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"]').textContent.includes('แผนที่ด้านล่างใช้ขนาดมาตรฐานเดิม')`);
  await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').click()`);
  await wait(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"]').textContent.includes('แผนที่และพื้นที่ว่างด้านล่างใช้ขนาดอ้างอิง')`);
  await evaluate(`var s=document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]');s.selectedIndex=2;s.dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(`!document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]')`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze').click()`);
  await wait(`Boolean(document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]'))`, 120000);
  await wait(`document.querySelectorAll('button[aria-label^="ดูรถคันที่"]').length>1`, 120000);
  await evaluate(`document.querySelector('button[aria-label="ดูรถคันที่ 2"]').click()`);
  assert.match(await evaluate(`document.querySelector('section[aria-label="จำแนกรุ่นรถทดลอง"] h3').textContent`), /คันที่ 2/);
  const nextImage = join(temp, `another-image${extname(image)}`);
  await copyFile(image, nextImage);
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [nextImage] });
  await wait(`!document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]'))`), false);
  console.log('PASS: one Analyze action detects and classifies, model selection, top3, crop preview, YOLO multi-crop selection, reset on model/file changes.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
  else child.kill();
}
