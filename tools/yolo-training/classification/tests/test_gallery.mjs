// Real offline-browser test; only the native file-picker boundary is replaced.
// Uses synthetic images, built-in Node APIs, and an already-installed Chromium.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const python = process.env.PARKMAP_TEST_PYTHON || join(root, 'apps/vision-api/.venv/Scripts/python.exe');
const browser = process.env.PARKMAP_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const temp = await mkdtemp(join(tmpdir(), 'parkmap-review-test-'));
const fixtureCode = `
import io,json,sys,zipfile
from pathlib import Path
from PIL import Image
sys.path.insert(0,sys.argv[1])
from prepare import prepare
root=Path(sys.argv[2]);archive=root/'source.zip'
with zipfile.ZipFile(archive,'w') as z:
 z.writestr('data.yaml','nc: 2\\nnames: [model_a, model_b]\\n')
 for index,color in enumerate(('red','blue','green')):
  stream=io.BytesIO();Image.new('RGB',(40,20),color).save(stream,'PNG')
  z.writestr(f'train/images/{index}.png',stream.getvalue())
  z.writestr(f'train/labels/{index}.txt',f'{index%2} 0.5 0.5 0.5 0.5')
config={'seed':42,'ratios':{'train':.7,'val':.15,'test':.15},'sources':[{'id':'fixture','archive':str(archive),'yaml':'data.yaml','splits':{'train':'train','val':'valid','test':'test'},'class_map':{'model_a':'model_a','model_b':'model_b'},'license':{'name':'test','credit':'synthetic','url':'local'}}]}
p=root/'config.json';p.write_text(json.dumps(config));run=prepare(p,root/'out')
from prepare_review import build_workspace
staging={'workspace':'honda2','title':'HONDA 2','canonical_config':str(p),'source':config['sources'][0],'mapping':{'model_a':{'default_class':'model_a','candidates':['model_a']},'model_b':{'default_class':None,'candidates':['model_b']}}}
sp=root/'staging.json';sp.write_text(json.dumps(staging));build_workspace(sp,root/'staging')
print(run)
`;
const run = execFileSync(python, ['-c', fixtureCode, join(root, 'tools/yolo-training/classification'), temp], { encoding: 'utf8' }).trim();
const listener = createServer();
await new Promise(resolveListen => listener.listen(0, '127.0.0.1', resolveListen));
const port = listener.address().port;
await new Promise(resolveClose => listener.close(resolveClose));
const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${join(temp, 'profile')}`, pathToFileURL(join(run, 'index.html')).href], { windowsHide: true, stdio: 'ignore' });
let socket;
let serial = 0;
const pending = new Map();
async function call(method, params = {}) {
  return new Promise((resolveCall, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function idle() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!saving && !reviewBusy')) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  assert.fail('File save did not settle');
}
async function validReview(value) {
  const path = join(temp, 'saved-review.json');
  await writeFile(path, JSON.stringify(value));
  execFileSync(python, ['-c', `
import json,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from prepare import load_review,read_jsonl
run=Path(sys.argv[2]);classes={'model_a','model_b'}
load_review(Path(sys.argv[3]),json.loads((run/'images.json').read_text()),read_jsonl(run/'manifest.jsonl'),classes)
`, join(root, 'tools/yolo-training/classification'), run, path]);
}
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = pages.find(page => page.type === 'page' && page.url.startsWith('file:'));
      if (target) break;
    } catch { /* Chromium is still starting. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.ok(target, 'Offline browser started');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  await call('Runtime.enable');
  await evaluate(`window.saved=[]; window.pickerCalls=0; window.failWrite=false;
    window.showSaveFilePicker=async()=>{window.pickerCalls++;return {name:'review.json',createWritable:async()=>({write:async text=>{if(window.failWrite)throw Error('disk full');window.pendingText=text},close:async()=>{window.saved.push(JSON.parse(window.pendingText))},abort:async()=>{}})}}`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-id]').length`), 1, 'Review starts with one image');
  const queue = await evaluate('data.annotations.map(a=>a.annotation_id)');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate('window.pickerCalls'), 0, 'N must not open a save-file dialog');
  assert.equal(await evaluate('review.annotations[' + JSON.stringify(queue[0]) + '].confirmed'), true);
  assert.equal(await evaluate('dirty'), true, 'N retains a pending decision until explicit file save');
  await evaluate(`$('exportReview').click()`);
  await idle();
  assert.equal(await evaluate('window.pickerCalls'), 1, 'Only explicit file save opens the picker');
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[1], 'N saves and advances exactly one image');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',bubbles:true}))`);
  await idle();
  const rejectedByKey = await evaluate('review');
  assert.equal(rejectedByKey.annotations[queue[1]].exclude, true);
  assert.ok(rejectedByKey.annotations[queue[1]].reason);
  assert.equal(await evaluate('window.saved.length'), 1, 'M does not write even when a save file was already selected');
  assert.equal(await evaluate('dirty'), true);
  await validReview(rejectedByKey);
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[2], 'M excludes and advances exactly one image');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[1], 'Left returns to the previous image');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}))`);
  const writesBeforeIgnoredKeys = await evaluate('revision');
  await evaluate(`document.querySelector('[data-field=reason]').focus();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  assert.equal(await evaluate('revision'), writesBeforeIgnoredKeys, 'Typing in a field never confirms an image');
  await evaluate(`document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',repeat:true,bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',ctrlKey:true,bubbles:true}))`);
  assert.equal(await evaluate('revision'), writesBeforeIgnoredKeys, 'Held keys and modifier shortcuts are ignored');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ื',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate('review.annotations[' + JSON.stringify(queue[2]) + '].confirmed'), true, 'Physical N also works on a Thai keyboard layout');
  const finalWrites = await evaluate('revision');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate('revision'), finalWrites, 'End of queue does not repeatedly decide the last image');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}));window.failWrite=true;document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[2], 'N advances without invoking file writes');
  assert.equal(await evaluate('window.saved.length'), 1);
  assert.equal(await evaluate('dirty'), true);
  // Start the existing grid-workflow checks from a clean page.
  await evaluate('dirty=false;drafts.clear()');
  await call('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('[data-action=save]'))`)) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  await evaluate(`window.saved=[];window.pickerCalls=0;window.failWrite=false;
    window.showSaveFilePicker=async()=>{window.pickerCalls++;return {name:'review.json',createWritable:async()=>({write:async text=>{if(window.failWrite)throw Error('disk full');window.pendingText=text},close:async()=>{window.saved.push(JSON.parse(window.pendingText))},abort:async()=>{}})}};$('gridMode').click()`);
  const first = await evaluate(`(()=>{const card=document.querySelector('[data-id]');return {id:card.dataset.id,button:Boolean(card.querySelector('[data-action=save]')),checkboxes:document.querySelectorAll('input[type=checkbox]').length}})()`);
  assert.equal(first.button, true, 'A card has an explicit save button');
  assert.equal(first.checkboxes, 0, 'Review uses buttons instead of checkboxes');
  await evaluate(`document.querySelector('[data-action=save]').click()`);
  await idle();
  assert.equal(await evaluate('window.pickerCalls'), 0, 'Card decisions also never open a save dialog');
  await evaluate(`$('exportReview').click()`);
  await idle();
  const saved = await evaluate(`window.saved.at(-1)`);
  assert.equal(saved.annotations[first.id].confirmed, true, 'Save records the explicit human confirmation');
  assert.equal(await evaluate('dirty'), false, 'Dirty clears only after a successful file close');
  assert.equal(await evaluate('window.pickerCalls'), 1);
  await validReview(saved);
  const originalReview = JSON.parse(await readFile(join(run, 'review_applied.json'), 'utf8'));
  assert.deepEqual(originalReview, {}, 'Reviewing never edits the immutable input snapshot');
  const second = await evaluate(`(()=>{
    const card=document.querySelectorAll('[data-id]')[1],field=card.querySelector('[data-field=class]');
    field.value='model_a';field.dispatchEvent(new Event('input',{bubbles:true}));
    return {id:card.dataset.id,decided:Boolean(review.annotations[card.dataset.id]),writes:window.saved.length};
  })()`);
  assert.equal(second.decided, false, 'Editing a class alone never confirms it');
  await evaluate(`document.querySelectorAll('[data-action=save]')[1].click()`);
  await idle();
  assert.equal(await evaluate('window.saved.length'), second.writes, 'Correction without a reason is not saved');
  await evaluate(`(()=>{const card=document.querySelectorAll('[data-id]')[1],reason=card.querySelector('[data-field=reason]');reason.value='Synthetic label correction';reason.dispatchEvent(new Event('input',{bubbles:true}));card.querySelector('[data-action=save]').click()})()`);
  await idle();
  assert.equal(await evaluate('window.saved.length'), second.writes, 'Correction waits for explicit file save');
  await evaluate(`$('exportReview').click()`);
  await idle();
  const corrected = await evaluate(`window.saved.at(-1)`);
  assert.equal(corrected.annotations[second.id].canonical_class, 'model_a');
  assert.equal(corrected.annotations[second.id].confirmed, true);
  assert.equal(await evaluate('window.pickerCalls'), 1, 'Subsequent saves reuse the selected file');
  await validReview(corrected);
  await evaluate(`document.querySelectorAll('[data-action=exclude]')[1].click()`);
  await idle();
  await evaluate(`$('exportReview').click()`);
  await idle();
  const excluded = await evaluate(`window.saved.at(-1)`);
  assert.equal(excluded.annotations[second.id].exclude, true);
  assert.equal(excluded.annotations[second.id].canonical_class, undefined, 'Excluding a correction still produces valid review JSON');
  await validReview(excluded);
  const writesBeforeError = await evaluate('window.saved.length');
  await evaluate(`window.failWrite=true;document.querySelector('[data-action=reset]').click();$('exportReview').click()`);
  await idle();
  assert.equal(await evaluate('dirty'), true, 'Write failure retains unsaved state');
  assert.equal(await evaluate('window.saved.length'), writesBeforeError);
  assert.match(await evaluate(`$('notice').textContent`), /disk full/);
  await evaluate(`window.failWrite=false;$('exportReview').click()`);
  await idle();
  assert.equal(await evaluate('dirty'), false);
  assert.equal(await evaluate(`window.saved.at(-1).annotations[${JSON.stringify(first.id)}]`), undefined, 'Retry writes the latest reset decision');
  await evaluate(`document.querySelectorAll('[data-action=select]')[0].click();document.querySelectorAll('[data-action=select]')[1].click();$('group').click();$('exportReview').click()`);
  await idle();
  assert.equal(await evaluate('window.saved.at(-1).same_vehicle_groups[0].length'), 2);
  await evaluate(`(()=>{$('pairsTab').click();const card=document.querySelector('[data-pair]'),field=card.querySelector('[data-field=decision]'),reason=card.querySelector('[data-field=reason]');field.value='distinct';reason.value='Synthetic distinct images';reason.dispatchEvent(new Event('input',{bubbles:true}));card.querySelector('[data-action=savePair]').click();$('exportReview').click()})()`);
  await idle();
  const withPair = await evaluate('window.saved.at(-1)');
  assert.equal(withPair.similar_pairs[0].decision, 'distinct');
  await validReview(withPair);
  const downloads = join(temp, 'downloads');
  await mkdir(downloads);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await evaluate(`$('downloadReview').click()`);
  let downloaded;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { downloaded = JSON.parse(await readFile(join(downloads, 'review.json'), 'utf8')); break; } catch { /* Download still finishing. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  assert.deepEqual(downloaded, withPair, 'Fallback really downloads the saved review JSON');
  await evaluate('dirty=false;drafts.clear()');
  await call('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('[data-action=save]'))`)) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  await evaluate(`window.showSaveFilePicker=async()=>{throw new DOMException('cancelled','AbortError')};document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[1], 'N never waits for a file picker');
  await evaluate(`$('exportReview').click()`);
  await idle();
  assert.equal(await evaluate('dirty'), true, 'Cancelled picker retains decisions for retry');
  assert.equal(await evaluate('Boolean(fileHandle)'), false);
  assert.match(await evaluate(`$('notice').textContent`), /ยกเลิก/);
  assert.equal(await evaluate(`$('exportReview').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[1], 'Cancelling an explicit save leaves the current image unchanged');
  await evaluate(`window.saved=[];window.failWrite=false;window.showSaveFilePicker=async()=>({name:'review.json',createWritable:async()=>({write:async text=>{window.pendingText=text},close:async()=>{window.saved.push(JSON.parse(window.pendingText))},abort:async()=>{}})});review={version:1,annotations:{},images:{},same_vehicle_groups:[],similar_pairs:[]};dirty=false;$('flagFilter').value='unconfirmed';$('flagFilter').dispatchEvent(new Event('input'))`);
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[1], 'Unconfirmed filter advances to the next item without skipping');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`), queue[2], 'Rejecting from a shrinking filtered queue does not skip');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',bubbles:true}))`);
  await idle();
  assert.equal(await evaluate(`document.querySelectorAll('[data-id]').length`), 0, 'The filtered queue finishes without repeating another image');
  await evaluate('dirty=false;drafts.clear()');
  await call('Page.navigate', { url: pathToFileURL(join(temp, 'staging/index.html')).href });
  for (let attempt=0;attempt<100;attempt++) {
    if(await evaluate(`Boolean(document.querySelector('[data-id]')) && typeof workspace!=='undefined' && Boolean(workspace)`))break;
    await new Promise(resolveWait=>setTimeout(resolveWait,25));
  }
  await evaluate(`page=data.annotations.findIndex(a=>a.requires_class_selection);render();window.pickerCalls=0;window.showSaveFilePicker=async()=>{window.pickerCalls++;throw Error('unexpected picker')}`);
  const ambiguous=await evaluate(`document.querySelector('[data-id]').dataset.id`);
  assert.equal(await evaluate(`document.querySelector('[data-field=class]').value`),'','Ambiguous source must not select the first class');
  await evaluate(`quickDecision('save')`);
  assert.equal(await evaluate('Object.keys(review.annotations).length'),0,'N cannot accept an unresolved class');
  assert.equal(await evaluate(`document.querySelector('[data-id]').dataset.id`),ambiguous);
  await evaluate(`document.querySelector('[data-field=class]').value='model_b';quickDecision('save')`);
  assert.deepEqual(await evaluate(`review.annotations[${JSON.stringify(ambiguous)}]`),{confirmed:true,canonical_class:'model_b',reason:'ผู้ตรวจระบุรุ่นจากภาพ'});
  assert.equal(await evaluate('window.pickerCalls'),0,'Reviewing never opens a save picker');
  assert.equal(await evaluate('reviewFilename'),'review-honda2.json');
  console.log('PASS: N/M review, explicit saves, downloads, grouping, and ambiguous source selection guard.');
  console.log(`Synthetic fixture: ${run}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await evaluate('dirty=false').catch(() => {});
    await call('Browser.close').catch(() => {});
    socket.close();
  } else child.kill();
}
