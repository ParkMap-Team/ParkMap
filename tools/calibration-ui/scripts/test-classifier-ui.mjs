// Opt-in real-browser smoke test. Requires local API/UI and YOLO11m-seg.
// No model training, dataset writes, or intercepted inference responses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const image = resolve(process.argv[3] ?? '../../apps/vision-api/test-data/auto-parking/20260925_0931.jpeg');
const inspectOnly = process.argv.includes('--inspect-only');
const horizontalOnly = process.argv.includes('--horizontal-only');
const compareGaps = !inspectOnly && !horizontalOnly;
const incomingWidthArgument = process.argv.find(value => value.startsWith('--incoming-width='))?.split('=')[1];
const compareSegmentation = true;
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
  await wait(`Boolean(document.querySelector('section[aria-label="Segmentation experiment"]'))`, 60000);
  await wait(`Object.keys(document.querySelector('input[type=file]')).some(k=>k.startsWith('__reactProps'))`);
  await call('DOM.enable');
  const doc = await call('DOM.getDocument');
  const input = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [image] });
  await wait(`document.body.innerText.includes(${JSON.stringify(image.split(/[\\/]/).at(-1))})`);
  if (incomingWidthArgument) await evaluate(`var widthInput=document.querySelector('input[aria-label="ความกว้างรถที่จะเข้าจอด"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(widthInput,${JSON.stringify(incomingWidthArgument)});widthInput.dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze').click()`);
  await wait(`Boolean(document.querySelector('svg[aria-label="Motorcycle segmentation polygons"] polygon'))`, 120000);
  assert.equal(await evaluate(`Boolean(document.getElementById('summary-title'))`), false);
  assert.equal(await evaluate(`([...document.querySelectorAll('h2')]).some(el=>el.textContent==='Parking map')`), false);
  assert.equal(await evaluate(`([...document.querySelectorAll('button')]).some(el=>el.textContent==='Physical Map'||el.textContent==='Camera View')`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('select[aria-label="โมเดลจำแนกรุ่น"]'))`), false);
  assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Detected image segmentation"] g').length`), await evaluate(`document.querySelectorAll('svg[aria-label="Motorcycle segmentation polygons"] g').length`));
  assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Detected image segmentation"] polygon').length`), await evaluate(`document.querySelectorAll('svg[aria-label="Motorcycle segmentation polygons"] polygon').length`));
  if (compareSegmentation) {
    await wait(`document.querySelectorAll('svg[aria-label="Motorcycle segmentation polygons"] polygon').length > 0`, 120000);
    console.log(await evaluate(`document.querySelector('section[aria-label="Segmentation experiment"]').innerText.split(String.fromCharCode(10)).slice(0,5).join(' | ')`));
  }
  if (inspectOnly) {
    await wait(`document.querySelectorAll('[data-inspect-detection]').length > 0`);
    const count = await evaluate(`document.querySelectorAll('[data-inspect-detection]').length`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="เลือกรถที่ Seg ตรวจพบ"]').options.length`), count+1);
    await evaluate(`document.querySelector('[data-inspect-detection="detection_1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    await wait(`document.querySelector('[data-detection-inspection]')?.dataset.detectionInspection === 'detection_1'`);
    assert.equal(await evaluate(`document.querySelector('[data-inspect-detection="detection_1"]').getAttribute('aria-pressed')`), 'true');
    assert.match(await evaluate(`document.querySelector('[data-detection-inspection]').textContent`), /Seg ตรวจพบ/);
    if (process.argv.includes('--row-distance')) {
      await wait(`Boolean(document.querySelector('[data-image-row-distance="detection_1"]'))`);
      assert.equal(await evaluate(`document.querySelector('[data-metric-row-distance]').dataset.metricRowDistance`), 'detection_1');
      const witness = await evaluate(`(() => {
        const line=document.querySelector('[data-image-row-distance="detection_1"] line');
        const anchor=document.querySelector('[data-ground-anchor="detection_1"]');
        const end=document.querySelector('[data-image-row-distance="detection_1"] [data-row-distance-end="image"]');
        return { x1:Number(line.getAttribute('x1')), y1:Number(line.getAttribute('y1')),
          anchorX:Number(anchor.getAttribute('cx')), anchorY:Number(anchor.getAttribute('cy')),
          x2:Number(line.getAttribute('x2')), y2:Number(line.getAttribute('y2')),
          endX:Number(end.getAttribute('cx')), endY:Number(end.getAttribute('cy')) };
      })()`);
      assert.ok(Math.abs(witness.x1-witness.anchorX)<1e-6 && Math.abs(witness.y1-witness.anchorY)<1e-6);
      assert.equal(witness.x2,witness.endX); assert.equal(witness.y2,witness.endY);
      assert.match(await evaluate(`document.querySelector('[data-image-row-distance]').textContent`), /≈.*ซม\./);
      console.log('PASS: row-distance starts at exact Seg bottom-centre and shares its witness endpoint with the image/metric overlays.');
    }
    await evaluate(`var choice=document.querySelector('select[aria-label="เลือกรถที่ Seg ตรวจพบ"]');choice.value=String(choice.options.length-2);choice.dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('[data-detection-inspection]')?.dataset.detectionInspection === 'detection_${count}'`);
    if (await evaluate(`Boolean(document.querySelector('[data-occupancy-scope="BOTTOM_EDGE_ANCHOR"], [data-occupancy-scope="IMAGE_ROW_POINT_OR_MASK"], [data-occupancy-scope="IMAGE_NEAREST_LOWER_EDGE"]'))`)) {
      assert.ok(await evaluate(`document.querySelector('[data-detection-inspection]').dataset.assignmentReason`));
      console.log('Row assignment reason is present for an original Seg ID.');
    }
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='ปิดรายละเอียดรถ').click()`);
    await wait(`!document.querySelector('[data-detection-inspection]')`);
    if (process.argv.includes('--screenshot')) {
      await evaluate(`document.querySelector('[data-inspect-detection="detection_1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('[aria-label="ตรวจรถที่ Seg ตรวจพบ"]').scrollIntoView({block:'center'})`);
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const screenshotPath = join(temp, 'seg-detection-inspector.png');
      await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
      console.log('Screenshot: ' + screenshotPath);
    }
    console.log('PASS: Seg vehicle click, original ID selection, inspection status, close and dropdown fallback ('+count+' detections).');
  }
  if (horizontalOnly) {
    await wait(`Boolean(document.querySelector('section[aria-label="รถแนวนอนและระยะถึงรถข้างเคียง"]'))`, 120000);
    const count = await evaluate(`document.querySelectorAll('[data-horizontal-choice]').length`);
    assert.ok(count > 0, 'Test image must contain a horizontal-image detection');
    assert.equal(await evaluate(`document.querySelectorAll('[data-horizontal-vehicle]').length`), count);
    const measuredId = await evaluate(`[...document.querySelectorAll('[data-horizontal-choice]')].find(el=>el.textContent.includes('≈'))?.dataset.horizontalChoice`);
    assert.ok(measuredId, 'Test image must contain a comparable reference pair');
    await evaluate(`document.querySelector('[data-horizontal-choice="${measuredId}"]').click()`);
    await wait(`document.querySelector('[data-horizontal-detail]')?.dataset.horizontalDetail === '${measuredId}'`);
    assert.equal(await evaluate(`document.querySelector('[data-horizontal-detail]').dataset.horizontalStatus`), 'APPROXIMATE_REFERENCE');
    assert.match(await evaluate(`document.querySelector('[data-horizontal-detail]').textContent`), /≈\s*\d+\.\d{2}/);
    assert.equal(await evaluate(`document.querySelector('[data-horizontal-distance]').dataset.horizontalDistance`), measuredId);
    const unsupportedId = await evaluate(`[...document.querySelectorAll('[data-horizontal-choice]')].find(el=>el.textContent.includes('ยังวัดไม่ได้'))?.dataset.horizontalChoice`);
    if (unsupportedId) {
      await evaluate(`document.querySelector('[data-horizontal-choice="${unsupportedId}"]').click()`);
      await wait(`document.querySelector('[data-horizontal-detail]')?.dataset.horizontalDetail === '${unsupportedId}'`);
      assert.equal(await evaluate(`document.querySelectorAll('[data-horizontal-distance]').length`), 0);
    }
    await evaluate(`document.querySelector('section[aria-label="รถแนวนอนและระยะถึงรถข้างเคียง"] input[type=checkbox]').click()`);
    await wait(`document.querySelectorAll('[data-horizontal-vehicle]').length === 0`);
    await evaluate(`document.querySelector('section[aria-label="รถแนวนอนและระยะถึงรถข้างเคียง"] input[type=checkbox]').click();document.querySelector('[data-horizontal-choice="${measuredId}"]').click()`);
    await wait(`document.querySelectorAll('[data-horizontal-vehicle]').length === ${count}`);
    if (process.argv.includes('--screenshot')) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').scrollIntoView({block:'start'})`);
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const screenshotPath = join(temp, 'horizontal-vehicles.png');
      await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
      console.log('Screenshot: ' + screenshotPath);
    }
    console.log('PASS: horizontal references, approximate nearest-distance label, unsupported projection suppression, toggle and selection ('+count+' vehicles).');
  }
  if (compareGaps) {
    await wait(`Boolean(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]'))`, 120000);
    const green = await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`);
    assert.equal(await evaluate(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.evaluationMode`), 'CONTINUOUS_GAPS');
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation free-space candidates"] [data-state="WIDTH_SUFFICIENT"]').length`), green);
    if (green > 0) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation free-space candidates"] [data-state="WIDTH_SUFFICIENT"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('[aria-label="ระยะช่องว่างที่เลือก"]')?.textContent.includes('ยังไม่ตรวจความยาวรถ')`);
      await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ความกว้างเพียงพอตามค่าอ้างอิง')`);
      const greenGapId = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="WIDTH_SUFFICIENT"]').dataset.gapId`);
      assert.equal(await evaluate(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]').dataset.gapId`), greenGapId);
      console.log('Compatible family count: ' + await evaluate(`document.querySelectorAll('[data-compatible-family]').length`));
      if (await evaluate(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="UNKNOWN"]'))`)) {
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="UNKNOWN"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ยังไม่แนะนำรุ่นรถ')`);
        assert.equal(await evaluate(`document.querySelectorAll('[data-compatible-family]').length`), 0);
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="WIDTH_SUFFICIENT"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ความกว้างเพียงพอตามค่าอ้างอิง')`);
      }
      assert.match(await evaluate(`document.querySelector('[aria-label="ระยะช่องว่างที่เลือก"]').textContent`), /\d+\.\d{2}/);
    }
    console.log('Gap result: ' + await evaluate(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').innerText.slice(0,500)`));
    if (incomingWidthArgument) {
      await wait(`Boolean(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]'))`);
      assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.width)`), Number(incomingWidthArgument));
      assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.allocation)`), Number(incomingWidthArgument));
      const incomingIds = await evaluate(`([...document.querySelectorAll('[data-incoming-placement]')]).map(el=>el.dataset.incomingPlacement)`);
      assert.equal(incomingIds.length, await evaluate(`Number(document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').dataset.recommendedCount)`));
      if (incomingIds.length > 0) {
        const incomingId = incomingIds[Math.min(1,incomingIds.length-1)];
        await evaluate(`document.querySelector('[data-incoming-placement="${incomingId}"]').click()`);
        await wait(`document.querySelector('svg[aria-label="Segmentation free-space candidates"] [data-incoming-id]')?.dataset.incomingId === '${incomingId}'`);
      } else {
        assert.equal(await evaluate(`document.querySelectorAll('[data-incoming-id]').length`), 0);
        assert.ok(await evaluate(`document.querySelector('section[aria-label="ผลแนะนำตำแหน่งสำหรับรถที่กรอก"]').textContent.includes('ยังไม่พบตำแหน่ง')`));
      }
      console.log('Incoming vehicle recommendations: ' + incomingIds.length);
    }
    await wait(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"]'))`);
    assert.equal(await evaluate(`(() => { const labels = [...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-row-label]')]; return labels.sort((a,b) => a.getBoundingClientRect().top-b.getBoundingClientRect().top).map(el=>el.dataset.rowLabel).join(','); })()`), 'row_5,row_4,row_3,row_2,row_1');
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-state="WIDTH_SUFFICIENT"]').length`), green);
    assert.equal(await evaluate(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-row-clipped="true"][clip-path] [data-occupied]'))`), true);
    assert.equal(await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-occupied]')]).every(el=>el.dataset.occupiedDisplay==='ROW_DEPTH')`), true);
    assert.equal(await evaluate(`(() => { const map=document.querySelector('svg[aria-label="Segmentation metric top-down map"]'); const group=map.querySelector('[data-row-clipped="true"]'); const id=group.getAttribute('clip-path').slice(5,-1); return document.getElementById(id)?.children.length === map.querySelectorAll('[data-row-label]').length; })()`), true);
    const gapCount = await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]').length`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-gap-result]').length`), gapCount);
    const statusesBeforeBackground = await evaluate(`([...document.querySelectorAll('[data-gap-result]')]).map(el=>[el.dataset.gapResult,el.dataset.state])`);
    for (const kind of ['OCCUPIED_REFERENCE', 'NOT_EVALUATED']) {
      if (await evaluate(`Boolean(document.querySelector('[data-background-kind="${kind}"]'))`)) {
        await evaluate(`document.querySelector('[data-background-kind="${kind}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
        await wait(`Boolean(document.querySelector('[aria-label="รายละเอียดพื้นที่สีขาว"]'))`);
        await wait(`document.querySelector('[aria-label="ตรวจการบังของช่องที่เลือก"]')?.dataset.inspectionKind==='BACKGROUND'`);
        const inspectedId = await evaluate(`document.querySelector('[aria-label="ตรวจการบังของช่องที่เลือก"]').dataset.occlusionGap`);
        assert.equal(await evaluate(`document.querySelector('[data-selected-background]').dataset.selectedBackground`), inspectedId);
        assert.equal(await evaluate(`document.querySelector('svg[aria-label="ส่วนที่รถทับช่องในภาพ"] [data-image-inspection]').dataset.imageInspection`), inspectedId);
        assert.ok(await evaluate(`Boolean(document.querySelector('svg[aria-label="ภาพขยายตรวจการบัง"] image'))`));
        const label = kind === 'OCCUPIED_REFERENCE' ? 'ระบบนับเป็นพื้นที่รถอ้างอิง' : 'ยังไม่มีผลประเมินตำแหน่งนี้';
        assert.ok((await evaluate(`document.querySelector('[aria-label="รายละเอียดพื้นที่สีขาว"]').textContent`)).includes(label));
        assert.ok(await evaluate(`Boolean(document.querySelector('[data-selected-background]'))`));
        assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`), green);
        await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='ปิดรายละเอียดพื้นสีขาว').click()`);
        await wait(`!document.querySelector('[aria-label="รายละเอียดพื้นที่สีขาว"]')`);
        await wait(`document.querySelector('[aria-label="ตรวจการบังของช่องที่เลือก"]')?.dataset.inspectionKind==='CANDIDATE'`);
      }
    }
    assert.deepEqual(await evaluate(`([...document.querySelectorAll('[data-gap-result]')]).map(el=>[el.dataset.gapResult,el.dataset.state])`), statusesBeforeBackground);
    assert.equal(await evaluate(`document.querySelector('input[aria-label="ทดลองแสดงช่องกว้างพอ"]').checked`), false);
    assert.equal(await evaluate(`document.querySelectorAll('[data-width-preview="true"]').length`), 0);
    const originalStates = await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')]).map(el=>[el.dataset.gapId,el.dataset.state,el.getAttribute('fill')])`);
    const recommendationsBefore = await evaluate(`document.querySelectorAll('[data-incoming-placement]').length`);
    await evaluate(`document.querySelector('input[aria-label="ทดลองแสดงช่องกว้างพอ"]').click()`);
    await wait(`Boolean(document.querySelector('[aria-label="คำอธิบายโหมดความกว้างทดลอง"]'))`);
    const previewCount = await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-width-preview="true"]').length`);
    assert.equal(previewCount, await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-state="UNKNOWN"][data-width-check="SUFFICIENT"]').length`));
    assert.ok(await evaluate(`([...document.querySelectorAll('[data-width-preview="true"]')]).every(el=>el.dataset.state==='UNKNOWN' && el.getAttribute('fill').startsWith('url(#'))`));
    assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`), green);
    assert.equal(await evaluate(`document.querySelectorAll('[data-incoming-placement]').length`), recommendationsBefore);
    if (previewCount > 0) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-width-preview="true"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('section[aria-label="รุ่นรถที่กว้างพอกับช่องที่เลือก"]')?.textContent.includes('ยังไม่แนะนำรุ่นรถ')`);
      assert.equal(await evaluate(`document.querySelectorAll('[data-compatible-family]').length`), 0);
    }
    if (process.argv.includes('--screenshot')) {
      await evaluate(`document.querySelector('section[aria-label="แผนผัง 2D segmentation"]').scrollIntoView({block:'start'})`);
      const previewShot = await call('Page.captureScreenshot', {format:'png'});
      const previewPath = join(temp, 'width-only-preview.png');
      await writeFile(previewPath, Buffer.from(previewShot.data,'base64'));
      console.log('Width preview screenshot: ' + previewPath);
    }
    await evaluate(`document.querySelector('input[aria-label="ทดลองแสดงช่องกว้างพอ"]').click()`);
    await wait(`!document.querySelector('[aria-label="คำอธิบายโหมดความกว้างทดลอง"]')`);
    assert.deepEqual(await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')]).map(el=>[el.dataset.gapId,el.dataset.state,el.getAttribute('fill')])`), originalStates);
    console.log('Width preview: ' + previewCount + ' unknown regions; availability/recommendations unchanged');
    assert.equal(await evaluate(`document.querySelector('input[aria-label="ทดลองเดาแนวรถจากกรอบภาพ"]').checked`), false);
    const originalOccupiedPaths = await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-occupied]')]).map(el=>el.getAttribute('d'))`);
    await evaluate(`document.querySelector('input[aria-label="ทดลองเดาแนวรถจากกรอบภาพ"]').click()`);
    await wait(`Boolean(document.querySelector('[aria-label="ผลทดลองแนวรถจากกรอบภาพ"]'))`);
    assert.ok(await evaluate(`document.querySelectorAll('[data-orientation-choice]').length>0`));
    assert.ok(await evaluate(`document.querySelector('[aria-label="ผลทดลองแนวรถจากกรอบภาพ"]').textContent.includes('ยังไม่ใช้เปลี่ยนช่องเขียว/เหลือง')`));
    assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`), green);
    assert.deepEqual(await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-occupied]')]).map(el=>el.getAttribute('d'))`), originalOccupiedPaths);
    if (await evaluate(`Boolean(document.querySelector('[data-orientation-kind="HORIZONTAL_IMAGE"]'))`)) {
      const horizontalId = await evaluate(`document.querySelector('[data-orientation-kind="HORIZONTAL_IMAGE"]').dataset.orientationHypothesis`);
      await evaluate(`document.querySelector('[data-orientation-kind="HORIZONTAL_IMAGE"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('[data-selected-orientation]')?.dataset.selectedOrientation==='${horizontalId}'`);
    }
    console.log('Orientation preview: ' + await evaluate(`document.querySelector('[aria-label="ผลทดลองแนวรถจากกรอบภาพ"]').innerText.slice(0,250)`));
    if (process.argv.includes('--screenshot')) {
      await evaluate(`document.querySelector('[aria-label="แผนผัง 2D segmentation"]').scrollIntoView({block:'start'})`);
      const shot = await call('Page.captureScreenshot',{format:'png'});
      const screenshotPath = join(temp,'orientation-preview.png');
      await writeFile(screenshotPath,Buffer.from(shot.data,'base64'));
      console.log('Orientation screenshot: ' + screenshotPath);
    }
    await evaluate(`document.querySelector('input[aria-label="ทดลองเดาแนวรถจากกรอบภาพ"]').click()`);
    await wait(`!document.querySelector('[aria-label="ผลทดลองแนวรถจากกรอบภาพ"]')`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-orientation-hypothesis]').length`), 0);
    assert.deepEqual(await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')]).map(el=>[el.dataset.gapId,el.dataset.state,el.getAttribute('fill')])`), originalStates);
    const occludedId = await evaluate(`([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')]).find(el=>Number(el.dataset.occlusionCount)>0)?.dataset.gapId`);
    if (occludedId) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-gap-id="${occludedId}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('[aria-label="ตรวจการบังของช่องที่เลือก"]')?.dataset.occlusionGap==='${occludedId}'`);
      assert.ok(await evaluate(`document.querySelectorAll('svg[aria-label="ส่วนที่รถทับช่องในภาพ"] [data-occlusion-overlap]').length>0`));
      assert.ok(await evaluate(`Boolean(document.querySelector('svg[aria-label="ภาพขยายตรวจการบัง"] image'))`));
      await evaluate(`document.querySelector('input[aria-label="แสดงส่วนที่รถทับช่องในภาพ"]').click()`);
      await wait(`!document.querySelector('svg[aria-label="ส่วนที่รถทับช่องในภาพ"]')`);
      assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="ภาพขยายตรวจการบัง"] [data-occlusion-overlap]').length`), 0);
      assert.equal(await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.greenCount)`), green);
      await evaluate(`document.querySelector('input[aria-label="แสดงส่วนที่รถทับช่องในภาพ"]').click()`);
      await wait(`Boolean(document.querySelector('svg[aria-label="ส่วนที่รถทับช่องในภาพ"]'))`);
      await evaluate(`document.querySelector('[data-occlusion-source]').click()`);
      await wait(`Boolean(document.querySelector('[data-occlusion-source][aria-pressed="true"]'))`);
      assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="ภาพขยายตรวจการบัง"] [data-occluding-detection]').length`), 1);
      if (process.argv.includes('--screenshot')) {
        await evaluate(`document.querySelector('[aria-label="ตรวจการบังของช่องที่เลือก"]').scrollIntoView({block:'start'})`);
        const shot = await call('Page.captureScreenshot', {format:'png'});
        const screenshotPath = join(temp,'gap-occlusion-inspector.png');
        await writeFile(screenshotPath,Buffer.from(shot.data,'base64'));
        console.log('Occlusion inspector screenshot: ' + screenshotPath);
      }
    }
    assert.equal(await evaluate(`([...document.querySelectorAll('[data-gap-result]')]).every(el => /[0-9]+[.][0-9]{2}/.test(el.textContent) && el.textContent.includes(({WIDTH_SUFFICIENT:'กว้างพอ',ALMOST_AVAILABLE:'อาจจอดได้หากขยับรถข้างเคียง',INSUFFICIENT_WIDTH:'แคบเกินไป',UNKNOWN:'ยังยืนยันไม่ได้',FIT:'วางกรอบรถได้ (ทดลอง)'})[el.dataset.state]))`), true);
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-state="ALMOST_AVAILABLE"]').length`), await evaluate(`Number(document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"]').dataset.almostCount)`));
    if (await evaluate(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="ALMOST_AVAILABLE"]'))`)) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="ALMOST_AVAILABLE"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`Boolean(document.querySelector('[aria-label="คำแนะนำสีเหลือง"]'))`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="คำแนะนำสีเหลือง"]').textContent.includes('ยังไม่ได้คำนวณแผนขยับรถ')`));
      assert.ok(await evaluate(`Boolean(document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-advisory-target]'))`));
      assert.equal(await evaluate(`document.querySelectorAll('[data-compatible-family]').length`), 0);
    }
    assert.ok(await evaluate(`document.querySelector('section[aria-label="ผลช่องว่างทุกแถว"]').textContent.includes('ผลช่องว่างทุกแถว')`));
    const statesBefore = await evaluate(`Object.fromEntries([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')].map(el => [el.dataset.gapId, el.getAttribute('stroke')]))`);
    assert.ok(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-occupied]').length > 0`));
    assert.equal(await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`), false);
    assert.ok(await evaluate(`Boolean(document.querySelector('[data-occupancy-source="SEGMENTATION_ONLY"]'))`));
    assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] path[data-source="PRIMARY"]').length`), 0);
    assert.ok(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-selected-distance] text').length <= 1`));
    const roiViewBox = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="detector ของแผนผัง 2D"]')`), null);
    assert.equal(await evaluate(`document.querySelectorAll('[data-uncertainty-id]').length`), 0);
    assert.equal(await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`), roiViewBox);
    await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').click()`);
    await wait(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`);
    await evaluate(`document.querySelector('input[aria-label="แสดงรถนอก ROI"]').click()`);
    await wait(`!document.querySelector('input[aria-label="แสดงรถนอก ROI"]').checked`);
    assert.equal(await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').getAttribute('viewBox')`), roiViewBox);
    await evaluate(`document.querySelector('button[aria-label="ขยายแผนผัง segmentation"]').click()`);
    await wait(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').style.width === '150%'`);
    await evaluate(`document.querySelector('button[aria-label="ย่อแผนผัง segmentation"]').click()`);
    await wait(`document.querySelector('svg[aria-label="Segmentation metric top-down map"]').style.width === '100%'`);
    const chosen = await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]:last-of-type')?.dataset.gapId`);
    if (chosen) {
      await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-gap-id="${chosen}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait(`document.querySelector('section[aria-label="ผลหาช่องว่าง segmentation"] button[aria-pressed="true"]')?.textContent.includes('${chosen}')`);
      assert.match(await evaluate(`document.querySelector('[aria-label="ช่องว่าง 2D ที่เลือก"]').textContent`), /\d+\.\d{2}/);
      assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]')].map(el => [el.dataset.gapId, el.getAttribute('stroke')]))`), statesBefore);
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
        await evaluate(`document.querySelector('svg[aria-label="Segmentation metric top-down map"] [data-state="WIDTH_SUFFICIENT"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
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
  const nextImage = join(temp, `another-image${extname(image)}`);
  await copyFile(image, nextImage);
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [nextImage] });
  await wait(`document.querySelectorAll('svg[aria-label="Motorcycle segmentation polygons"] polygon').length===0`);
  assert.equal(await evaluate(`document.querySelectorAll('svg[aria-label="Segmentation metric top-down map"] [data-gap-id]').length`), 0);
  console.log('PASS: segmentation is primary, no classifier UI, gap selection and geometry previews, reset on file/input changes.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close(); }
  else child.kill();
}
