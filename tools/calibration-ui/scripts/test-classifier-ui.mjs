// Opt-in real-browser smoke test. Requires local API/UI, YOLO and completed classifiers.
// No model training, dataset writes, or intercepted inference responses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const image = resolve(process.argv[3] ?? '../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg');
const targetArchitecture = process.argv[4];
const compareGaps = process.argv.includes('--gaps');
const incomingWidthArgument = process.argv.find(value => value.startsWith('--incoming-width='))?.split('=')[1];
const compareSegmentation = process.argv.includes('--segmentation') || compareGaps;
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
  if (compareSegmentation) await evaluate(`document.querySelector('input[aria-label="เปรียบเทียบ YOLO11m-seg"]').click()`);
  if (compareGaps) await evaluate(`document.querySelector('input[aria-label="หาช่องว่างจาก segmentation"]').click()`);
  if (incomingWidthArgument) await evaluate(`var widthInput=document.querySelector('input[aria-label="ความกว้างรถที่จะเข้าจอด"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(widthInput,${JSON.stringify(incomingWidthArgument)});widthInput.dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze').click()`);
  await wait(`Boolean(document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]'))`, 120000);
  assert.equal(await evaluate(`document.querySelectorAll('section[aria-label="จำแนกรุ่นรถทดลอง"] ol li').length`), 3);
  assert.equal(await evaluate(`document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]').naturalWidth>0`), true);
  assert.match(await evaluate(`document.querySelector('[aria-label="ขนาดอ้างอิงของรถ"]').textContent`), /\d+\.\d{2}.*\d+\.\d{2}/);
  if (compareSegmentation) {
    await wait(`document.querySelectorAll('svg[aria-label="Motorcycle segmentation polygons"] polygon').length > 0`, 120000);
    console.log(await evaluate(`document.querySelector('section[aria-label="Segmentation experiment"]').innerText.split(String.fromCharCode(10)).slice(0,5).join(' | ')`));
  }
  if (compareGaps) {
    await wait(`Boolean(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]'))`, 120000);
    const green = await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`);
    assert.equal(await evaluate(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.evaluationMode`), 'VIRTUAL_SLOTS');
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation free-space candidates"] polygon[data-state="SLOT_CLEAR"]').length`), green);
    if (green > 0) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation free-space candidates"] polygon[data-state="SLOT_CLEAR"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('[aria-label="ระยะช่องว่างที่เลือก"]')?.textContent.includes('ยังไม่ตรวจความยาวรถ')`);
      await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ความกว้างเพียงพอตามค่าอ้างอิง')`);
      const greenGapId = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="SLOT_CLEAR"]').dataset.gapId`);
      assert.equal(await evaluate(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]').dataset.gapId`), greenGapId);
      console.log('Compatible family count: ' + await evaluate(`document.querySelectorAll('[data-compatible-family]').length`));
      if (await evaluate(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="UNKNOWN"]'))`)) {
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="UNKNOWN"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ยังไม่แนะนำรุ่นรถ')`);
        assert.equal(await evaluate(`document.querySelectorAll('[data-compatible-family]').length`), 0);
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="SLOT_CLEAR"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ความกว้างเพียงพอตามค่าอ้างอิง')`);
      }
      assert.match(await evaluate(`document.querySelector('[aria-label="ระยะช่องว่างที่เลือก"]').textContent`), /\d+\.\d{2}/);
    }
    console.log('Gap result: ' + await evaluate(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').innerText.slice(0,500)`));
    if (incomingWidthArgument) {
      await wait(`Boolean(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]'))`);
      assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.width)`), Number(incomingWidthArgument));
      assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.allocation)`), Math.max(1,Number(incomingWidthArgument)));
      const incomingIds = await evaluate(`([...document.querySelectorAll('[data-incoming-placement]')]).map(el=>el.dataset.incomingPlacement)`);
      assert.equal(incomingIds.length, await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.recommendedCount)`));
      assert.ok(incomingIds.length > 0);
      const incomingId = incomingIds[Math.min(1,incomingIds.length-1)];
      await evaluate(`document.querySelector('[data-incoming-placement="${incomingId}"]').click()`);
      await wait(`document.querySelector('svg[aria-label="Segmentation free-space candidates"] [data-incoming-id]')?.dataset.incomingId === '${incomingId}'`);
      console.log('Incoming vehicle recommendations: ' + incomingIds.length);
    }
    await wait(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"]'))`);
    assert.equal(await evaluate(`(() => { const labels = [...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-row-label]')]; return labels.sort((a,b) => a.getBoundingClientRect().top-b.getBoundingClientRect().top).map(el=>el.dataset.rowLabel).join(','); })()`), 'row_5,row_4,row_3,row_2,row_1');
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="SLOT_CLEAR"]').length`), green);
    const gapCount = await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] polygon[data-gap-id]').length`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-gap-result]').length`), gapCount);
    assert.equal(await evaluate(`([...document.querySelectorAll('[data-gap-result]')]).every(el => /[0-9]+[.][0-9]{2}/.test(el.textContent) && el.textContent.includes(({SLOT_CLEAR:'ช่องจำลองว่าง (ทดลอง)',WIDTH_SUFFICIENT:'กว้างพอ',INSUFFICIENT_WIDTH:'แคบเกินไป',UNKNOWN:'ยังยืนยันไม่ได้',FIT:'วางกรอบรถได้ (ทดลอง)'})[el.dataset.state]))`), true);
    const statesBefore = await evaluate(`Object.fromEntries([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] polygon[data-gap-id]')].map(el => [el.dataset.gapId, el.getAttribute('stroke')]))`);
    assert.ok(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-occupied]').length > 0`));
    assert.equal(await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`), false);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="detector ของแผนผัง 2D"]').value`), 'SEGMENTATION');
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-source="PRIMARY"]').length`), 0);
    assert.ok(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-selected-distance] text').length <= 1`));
    const roiViewBox = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`);
    await evaluate(`var detector=document.querySelector('select[aria-label="detector ของแผนผัง 2D"]');detector.value='BOTH';detector.dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-source="PRIMARY"]').length > 0`);
    assert.equal(await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`), roiViewBox);
    await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').click()`);
    await wait(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`);
    await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').click()`);
    await wait(`!document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`);
    assert.equal(await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`), roiViewBox);
    await evaluate(`var detector=document.querySelector('select[aria-label="detector ของแผนผัง 2D"]');detector.value='SEGMENTATION';detector.dispatchEvent(new Event('change',{bubbles:true}))`);
    await evaluate(`document.querySelector('button[aria-label="ขยายแผนผัง segmentation"]').click()`);
    await wait(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').style.width === '150%'`);
    await evaluate(`document.querySelector('button[aria-label="ย่อแผนผัง segmentation"]').click()`);
    await wait(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').style.width === '100%'`);
    const chosen = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-gap-id]:last-of-type')?.dataset.gapId`);
    if (chosen) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-gap-id="${chosen}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"] button[aria-pressed="true"]')?.textContent.includes('${chosen}')`);
      assert.match(await evaluate(`document.querySelector('[aria-label="ช่องว่าง 2D ที่เลือก"]').textContent`), /\d+\.\d{2}/);
      assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] polygon[data-gap-id]')].map(el => [el.dataset.gapId, el.getAttribute('stroke')]))`), statesBefore);
    }
    if (process.argv.includes('--screenshot')) {
      await evaluate(`document.querySelector('section[aria-label="แผนผัง 2D segmentation"]').scrollIntoView({block:'start'})`);
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const screenshotPath = join(temp, 'segmentation-top-down.png');
      await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
      console.log('Screenshot: ' + screenshotPath);
      if (incomingWidthArgument) {
        await evaluate(`document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').scrollIntoView({block:'start'})`);
        const incomingShot = await call('Page.captureScreenshot', { format: 'png' });
        const incomingPath = join(temp, 'incoming-vehicle-recommendations.png');
        await writeFile(incomingPath, Buffer.from(incomingShot.data, 'base64'));
        console.log('Incoming screenshot: ' + incomingPath);
      }
      if (green > 0) {
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] polygon[data-state="SLOT_CLEAR"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ความกว้างเพียงพอตามค่าอ้างอิง')`);
        await evaluate(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]').scrollIntoView({block:'start'})`);
        const familyShot = await call('Page.captureScreenshot', { format: 'png' });
        const familyPath = join(temp, 'gap-family-recommendations.png');
        await writeFile(familyPath, Buffer.from(familyShot.data, 'base64'));
        console.log('Family screenshot: ' + familyPath);
      }
    }
    if (await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation analysis row outlines"] polygon').length > 0`)) {
      assert.match(await evaluate(`document.querySelector('svg[aria-label="Segmentation analysis row outlines"]').textContent`), /row_1/);
      await evaluate(`document.querySelector('input[aria-label="แสดงกรอบ row"]').click()`);
      await wait(`!document.querySelector('svg[aria-label="Segmentation analysis row outlines"]')`);
      await evaluate(`document.querySelector('input[aria-label="แสดงกรอบ row"]').click()`);
      await wait(`document.querySelectorAll('svg[aria-label="Segmentation analysis row outlines"] polygon').length > 0`);
    }
  }
  if (incomingWidthArgument) {
    await evaluate(`var widthInput=document.querySelector('input[aria-label="ความกว้างรถที่จะเข้าจอด"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(widthInput,${JSON.stringify((Number(incomingWidthArgument)+.1).toFixed(3))});widthInput.dispatchEvent(new Event('input',{bubbles:true}))`);
    await wait(`!document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-incoming-id]').length`), 0);
  }
  assert.equal(await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').checked`), true);
  await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').click()`);
  await wait(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"]').textContent.includes('แผนที่ด้านล่างใช้ขนาดมาตรฐานเดิม')`);
  await evaluate(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"] input').click()`);
  await wait(`document.querySelector('section[aria-label="ทดลองขนาดตามคลาส"]').textContent.includes('แผนที่และพื้นที่ว่างด้านล่างใช้ขนาดอ้างอิง')`);
  await evaluate(`var s=document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]');s.selectedIndex=2;s.dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(`!document.querySelector('img[alt="Crop ที่ส่งเข้า classifier"]')`);
  if (compareGaps) assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation free-space candidates"] polygon[data-state="SLOT_CLEAR"]').length`), 0);
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
