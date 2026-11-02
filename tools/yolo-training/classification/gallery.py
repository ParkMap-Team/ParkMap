"""Static offline review UI and a human-readable audit. No CDN or web server."""

import json


def render_gallery(root, images, annotations, before, after, pairs):
    applied = json.loads((root / "review_applied.json").read_text(encoding="utf-8"))
    payload = json.dumps({"images": images, "annotations": annotations, "before": before, "after": after, "pairs": pairs, "review": applied}, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    (root / "index.html").write_text(PAGE.replace("__PAYLOAD__", payload), encoding="utf-8")


def write_report(root, before, after):
    text = ["# Motorcycle-family dataset audit", "", "**PROVISIONAL — not fully label-reviewed, not production-ready. No training performed.**", "",
            f"Input: {before['totals']['images']} source image files, {before['totals']['annotation_lines']} nonempty annotation lines, {before['totals']['valid_boxes']} valid boxes.",
            "Box counts are annotation counts, not counts of distinct physical motorcycles.", "",
            f"Byte duplicate groups: {len(before['byte_duplicate_groups'])}; originally crossing splits: {before['original_byte_duplicate_groups_cross_split']}.",
            f"Decoded RGB pixel duplicate groups: {len(before['pixel_duplicate_groups'])}; originally crossing splits: {before['original_pixel_duplicate_groups_cross_split']}.",
            f"Image annotation-conflict groups: {len(before['annotation_conflicts'])}; crop label-conflict groups: {len(before['crop_label_conflicts'])}.",
            f"Output: {after['classification_crops']} classification crops from {after['unique_source_images_included']} selected source image files, {after['known_groups_included']} known groups.",
            f"Dispositions: {json.dumps(after['dispositions'], sort_keys=True)}", "", "## Output splits", ""]
    for split, counts in after["split_counts"].items():
        text.append(f"- {split}: {counts['crops']} crops, {counts['groups']} known independent groups")
    text += ["", "## Leakage checks", ""]
    text += [f"- {key}: {value}" for key, value in after["leakage"].items()]
    text += ["", "These checks cover known hashes and declared relationships, not unrecognized same-vehicle views.", "", "## Review queue", "",
             f"- {after['unconfirmed_included_annotations']} included labels not confirmed by a person.",
             f"- {after['similar_pairs_pending']} of {after['similar_pairs_proposed']} heuristic similar-image pairs pending.",
             f"- {after['quarantined_annotations']} quarantined annotations; inspect conflicts in index.html and audit_before.json.",
             "- All readable valid crops, including quarantined and deduplicated annotations, remain in review-crops and the gallery.",
             "", "## Class coverage", ""]
    for name, summary in after["classes"].items():
        counts = ", ".join(f"{s}={v['crops']} crops/{v['groups']} groups" for s, v in summary["splits"].items())
        text.append(f"- {name}: {summary['independent_groups_known']} groups; {counts}; limitation={summary['limitation'] or 'none detected by coverage check'}")
    text += ["", "## Limitations", ""] + [f"- {value}" for value in after["limitations"]]
    text += ["", "## Credits and preprocessing", ""]
    for source in before["sources"]:
        license_info = source["license"]
        text += [f"- {source['id']}: {license_info['credit']}; {license_info['name']}; {license_info['url']}",
                 f"  Archive SHA-256: {source['archive_sha256']}", f"  Declared preprocessing: {source['known_preprocessing']}"]
    text += ["", "Original split/class image and box counts are in audit_before.json (images may contain multiple classes).",
             "All annotation lines and provenance, including exclusions and duplicates, are in manifest.jsonl.",
             "Open index.html for bulk review. Export decisions to an external review.json and rerun; see the pipeline README.", ""]
    (root / "REPORT.md").write_text("\n".join(text), encoding="utf-8")


PAGE = r'''<!doctype html>
<html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkMap — provisional motorcycle-family review</title>
<style>
body{font:15px system-ui;margin:0;background:#f3f5f8;color:#172238}header{padding:20px;background:#12233b;color:white}h1{font-size:23px;margin:0 0 8px}
button,select,input{font:inherit;padding:8px;margin:3px;border:1px solid #a5b2c6;border-radius:6px;max-width:100%;box-sizing:border-box}button{cursor:pointer;background:white}button:hover{background:#e2eaff}button:disabled{opacity:.5;cursor:default}
button.primary{background:#1d4ed8;color:white;border-color:#1d4ed8}button.danger{color:#a52718;border-color:#d2a7a1}button[aria-pressed=true]{background:#dbeafe;border-color:#2563eb}
.bar{padding:10px;background:white;border-bottom:1px solid #ccd4df;position:sticky;top:0;z-index:2}main{padding:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}
.card{background:white;padding:12px;border:1px solid #ced5df;border-radius:8px;overflow-wrap:anywhere}.card img{width:100%;height:200px;object-fit:contain;background:#e9edf2}.card.selected{outline:3px solid #2563eb}.card .fields{margin:10px 0}.card .fields label{display:block}.card input[data-field=reason]{width:100%}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.muted{color:#536174;font-size:13px}.warn{color:#8e3400}.badge{display:inline-block;background:#fff0c9;padding:4px 8px;border-radius:4px}.badge.confirmed{background:#dcfce7;color:#166534}.badge.excluded{background:#fee2e2;color:#991b1b}
.grid.single{display:block;max-width:1240px;margin:auto}.single .card{display:grid;grid-template-columns:minmax(0,1fr) 340px;column-gap:20px}.single .card>a:first-child{grid-column:1;grid-row:1/20;align-self:start}.single .card>:not(a:first-child){grid-column:2}.single .card>br{display:none}.single .card img{height:min(60vh,610px)}#keyboardControls{padding-top:5px}#reviewEnd{color:#8e3400;font-weight:600}kbd{font:inherit;font-weight:700}
@media(max-width:800px){.single .card{display:block}.single .card img{height:40vh}.bar{position:static}}
a{color:#1454b5}pre{white-space:pre-wrap;font-size:12px}summary{cursor:pointer}#summary{padding:12px 0}#notice{color:#06498e;padding-top:7px}#selection{max-height:80px;overflow:auto}
</style>
<header><h1>ParkMap · ตรวจข้อมูลตระกูลรถจักรยานยนต์</h1><b class="badge warn">PROVISIONAL — ยังมี label และตัวตนรถรอตรวจ</b><p>การกด “บันทึกรุ่นนี้” หมายถึงคุณตรวจแล้วว่ารถตรงกับรุ่นที่เลือก ไม่ต้องยืนยันภาพที่ยังไม่แน่ใจ</p></header>
<div class="bar">
<button id="cropsTab">ภาพรถ / รุ่น</button><button id="pairsTab">คู่ภาพคล้าย</button><button id="conflictsTab">ข้อมูลซ้ำที่ขัดแย้ง</button><button id="imagesTab">ภาพต้นทาง / ข้อผิดพลาด</button>
<label>นำเข้า review <input id="importReview" type="file" accept=".json"></label>
<button id="exportReview" class="primary">บันทึกไฟล์ review.json</button><button id="downloadReview">ดาวน์โหลดสำเนา</button><br>
<select id="classFilter" aria-label="กรองรุ่น"><option value="">ทุกรุ่น</option></select>
<select id="statusFilter" aria-label="สถานะในชุดข้อมูล"><option value="">ทุกสถานะในชุดข้อมูล</option></select>
<select id="flagFilter" aria-label="สถานะการตรวจ"><option value="">ทุกภาพ</option><option value="unconfirmed">รอยืนยันรุ่น</option><option value="flagged">กล่องผิดปกติ / annotation ผิด</option><option value="excluded">ตัดออกตามผลตรวจ</option></select>
<input id="query" placeholder="ค้นหารุ่น ชื่อไฟล์ หรือ ID" size="25"><button id="previous">ก่อนหน้า</button><button id="next">ถัดไป</button><span id="position"></span>
<div><button id="singleMode" aria-pressed="true">ตรวจทีละรูป</button><button id="gridMode" aria-pressed="false">ดูหลายรูป / จับกลุ่ม</button></div>
<div id="keyboardControls"><button id="acceptNext" class="primary" aria-keyshortcuts="N">N · รับรุ่นนี้แล้วถัดไป</button><button id="rejectNext" class="danger" aria-keyshortcuts="M">M · ไม่เอาแล้วถัดไป</button><span class="muted">← / → ดูรูปก่อนหน้า / ถัดไปโดยยังไม่ตัดสิน · คีย์ลัดไม่ทำงานขณะพิมพ์ในช่อง</span><div id="reviewEnd" role="status"></div></div>
<details><summary>รวมภาพที่ยืนยันว่าเป็นรถคันเดียวกัน</summary><p>กด “เลือกเพื่อจับกลุ่ม” ที่กรอบรถที่ตรงกัน แล้วกดรวมกลุ่ม ใช้กับรถคันเดียวกันจริง ๆ ไม่ใช่แค่รุ่นเดียวกัน</p><div id="selection"></div><button id="group">บันทึกกลุ่มที่เลือก</button><button id="clearSelection">ล้างการเลือก</button><pre id="groups"></pre></details>
<div id="notice" role="status" aria-live="polite">ใช้ N/M ตรวจภาพต่อเนื่องได้ ผลตรวจรออยู่ในหน้านี้ กด “บันทึกไฟล์ review.json” หรือ “ดาวน์โหลดสำเนา” เมื่อต้องการเก็บลงเครื่อง</div></div>
<main><div id="summary"></div><div id="content" class="grid"></div></main>
<script id="data" type="application/json">__PAYLOAD__</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent);
const workspace=data.after.review_workspace??null,reviewFilename=workspace?.review_filename??'review.json';
if(workspace){document.querySelector('h1').textContent=workspace.title+' · ตรวจภาพก่อนรวมชุดข้อมูล';document.getElementById('exportReview').textContent='บันทึกไฟล์ '+reviewFilename;}
const byImage=Object.fromEntries(data.images.map(i=>[i.image_id,i]));
const byAnnotation=Object.fromEntries(data.annotations.map(a=>[a.annotation_id,a]));
const classes=Object.keys(data.after.classes),selected=new Set(),drafts=new Map();
let review={version:1,annotations:{},images:{},same_vehicle_groups:[],similar_pairs:[],...data.review};
let tab='crops',page=0,dirty=false,revision=0,fileHandle=null,saving=false;
let singleMode=true,singleFinished=false,reviewBusy=false;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseClass=a=>a.mapped_class??a.canonical_class;
const currentClass=a=>review.annotations[a.annotation_id]?.canonical_class??baseClass(a);
function notice(text){$('notice').textContent=text;}
function mark(){revision++;dirty=true;notice('มีผลตรวจใหม่ที่ยังไม่บันทึกลงไฟล์');}
function options(values,current){return values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('');}
function hasDecisions(){return Object.keys(review.annotations).length||Object.keys(review.images).length||review.same_vehicle_groups.length||review.similar_pairs.length;}
function allowSave(){if(!hasDecisions()&&!revision){notice('ยังไม่มีผลตรวจให้บันทึก เลือกภาพแล้วกด “บันทึกรุ่นนี้” ก่อน');return false;}return true;}
function draftSuffix(){return drafts.size?' ยังมีช่องที่แก้ไว้แต่ไม่ได้กดบันทึกผลตรวจ':'';}
function downloadReview(){
  if(!allowSave())return;
  const blob=new Blob([JSON.stringify(review,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=reviewFilename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;
  notice('ส่งไฟล์ review.json ไปยังรายการดาวน์โหลดแล้ว โปรดตรวจไฟล์ที่บันทึก'+draftSuffix());
}
async function saveFile(){
  if(saving){notice('กำลังบันทึกไฟล์ ผลที่แก้เพิ่มจะยังอยู่ในหน้านี้');return false;}
  if(!allowSave())return false;
  if(!fileHandle&&typeof window.showSaveFilePicker!=='function'){downloadReview();return true;}
  saving=true;$('exportReview').disabled=true;$('downloadReview').disabled=true;let writable;
  try{
    if(!fileHandle)fileHandle=await window.showSaveFilePicker({suggestedName:reviewFilename,types:[{description:'ParkMap review JSON',accept:{'application/json':['.json']}}]});
    const snapshot=JSON.stringify(review,null,2)+'\n',savedRevision=revision;
    writable=await fileHandle.createWritable();await writable.write(snapshot);await writable.close();writable=null;
    dirty=revision!==savedRevision;
    notice(dirty?'บันทึกไฟล์แล้ว แต่มีผลตรวจใหม่ที่ยังไม่บันทึก กรุณากดบันทึกไฟล์อีกครั้ง':`บันทึกลง ${fileHandle.name} แล้ว${draftSuffix()}`);
    return !dirty;
  }catch(error){
    if(writable)await writable.abort().catch(()=>{});
    dirty=true;
    notice(error.name==='AbortError'?'ยกเลิกการบันทึก ผลตรวจยังอยู่ในหน้านี้ กดบันทึกไฟล์อีกครั้งได้':`ยังบันทึกไฟล์ไม่ได้: ${error.message} — ลองอีกครั้งหรือกดดาวน์โหลดสำเนา`);
    return false;
  }finally{saving=false;$('exportReview').disabled=false;$('downloadReview').disabled=false;}
}
function stageDecision(){
  notice('รับผลตรวจไว้ในหน้านี้แล้ว ยังไม่ได้บันทึกลงเครื่อง กด “บันทึกไฟล์ review.json” หรือ “ดาวน์โหลดสำเนา” เมื่อพร้อม');
}
$('classFilter').innerHTML+=options(classes);
$('statusFilter').innerHTML+=options([...new Set(data.annotations.map(a=>a.disposition))].sort());
function imageMarkup(id){
  const i=byImage[id];
  return `<div>${i.preview?`<a href="${esc(i.preview)}" target="_blank"><img loading="lazy" src="${esc(i.preview)}"></a>`:'อ่านภาพไม่ได้'}<div class="muted">${esc(i.source_dataset)} · ${esc(i.source_image)}<br>ID: ${esc(id)}<br>${esc(i.group_id)}</div></div>`;
}
function annotationCard(a){
  const decision=review.annotations[a.annotation_id]||{},draft=drafts.get('ann:'+a.annotation_id);
  const excluded=decision.exclude||review.images[a.image_id]?.exclude,confirmed=decision.confirmed&&!excluded;
  const status=excluded?'ตัดออกตามผลตรวจ':confirmed?'ยืนยันรุ่นแล้ว':'ใช้ label ต้นทาง · ยังไม่ยืนยัน';
  return `<article class="card ${selected.has(a.annotation_id)?'selected':''}" data-id="${esc(a.annotation_id)}">
    ${a.crop?`<a href="${esc(a.crop.path)}" target="_blank"><img loading="lazy" src="${esc(a.crop.path)}"></a>`:'ไม่มีกล่องที่ crop ได้'}
    <b>${esc(currentClass(a)||a.original_class||'annotation ผิดรูปแบบ')}</b><p><span class="badge ${excluded?'excluded':confirmed?'confirmed':''}" data-review-status>${status}</span></p>
    <div class="muted">${esc(a.source_image)}<br>${esc(a.annotation_id)}${workspace?`<br>ชื่อจากต้นทาง: ${esc(a.original_class)}<br>${esc(a.mapping_note??'')}`:''}</div>
    <div class="fields"><label>รุ่นรถ <select data-field="class">${!currentClass(a)?'<option value="">— เลือกรุ่นก่อนยืนยัน —</option>':''}${options(classes,draft?.className??currentClass(a))}</select></label>
    <label>เหตุผล <input data-field="reason" placeholder="จำเป็นเมื่อเปลี่ยนรุ่นหรือตัดออก" value="${esc(draft?.reason??decision.reason??'')}"></label></div>
    <button class="primary" data-action="save" ${!a.crop?'disabled':''}>บันทึกรุ่นนี้</button><button class="danger" data-action="exclude">ตัดออก</button>
    <button data-action="reset">ยกเลิกผลตรวจ</button><br>
    <button data-action="select" aria-pressed="${selected.has(a.annotation_id)}">${selected.has(a.annotation_id)?'เลือกแล้ว · ยกเลิกการเลือก':'เลือกเพื่อจับกลุ่ม'}</button>
    <p class="warn">${esc([...a.review_flags,...a.issues].join(', '))}</p>
    <details><summary>ภาพต้นทางและรายละเอียด annotation</summary>${imageMarkup(a.image_id)}<pre>${esc(JSON.stringify(a,null,2))}</pre></details></article>`;
}
function pairCard(pair){
  const key=[...pair.images].sort().join('|'),decision=review.similar_pairs.find(p=>[...p.images].sort().join('|')===key)||{},draft=drafts.get('pair:'+key);
  return `<article class="card" data-pair="${esc(key)}"><b>ภาพคล้าย — dHash ${pair.dhash_distance}</b><div class="pair">${pair.images.map(imageMarkup).join('')}</div>
    <p>ภาพคล้ายอาจเป็นรถคนละคัน ต้องตรวจยืนยันก่อนรวมกลุ่ม</p>
    <select data-field="decision">${options(['pending','distinct','same_vehicle_grouped','uncertain'],draft?.decision??decision.decision??'pending')}</select>
    <input data-field="reason" placeholder="เหตุผลที่ตรวจยืนยัน" value="${esc(draft?.reason??decision.reason??'')}">
    <button class="primary" data-action="savePair">บันทึกผลคู่นี้</button></article>`;
}
function sourceCard(i){
  const decision=review.images[i.image_id]||{},draft=drafts.get('image:'+i.image_id);
  return `<article class="card" data-image="${esc(i.image_id)}">${imageMarkup(i.image_id)}<p class="warn">${esc(i.issues.join(', '))}</p>
    <p>${decision.exclude?'ตัดภาพต้นทางนี้ออกตามผลตรวจ':'ยังไม่ได้ตัดภาพต้นทางออก'}</p>
    <input data-field="reason" placeholder="เหตุผลที่ตัดภาพออก" value="${esc(draft?.reason??decision.reason??'')}">
    <button class="danger" data-action="excludeImage">ตัดภาพนี้ออก</button><button data-action="resetImage">ยกเลิกการตัดออก</button></article>`;
}
function filteredAnnotations(){
  const q=$('query').value.toLowerCase(),c=$('classFilter').value,s=$('statusFilter').value,f=$('flagFilter').value;
  return data.annotations.filter(a=>{
    const decision=review.annotations[a.annotation_id]||{},excluded=decision.exclude||review.images[a.image_id]?.exclude;
    return (!c||currentClass(a)===c)&&(!s||a.disposition===s)&&(!q||JSON.stringify(a).toLowerCase().includes(q))&&
      (!f||(f==='unconfirmed'&&!decision.confirmed&&!excluded)||(f==='flagged'&&(a.issues.length||a.review_flags.length))||(f==='excluded'&&excluded));
  });
}
function updateKeyboardControls(){
  const active=tab==='crops'&&singleMode;
  $('keyboardControls').hidden=!active;
  $('singleMode').disabled=tab!=='crops';$('gridMode').disabled=tab!=='crops';
  $('singleMode').setAttribute('aria-pressed',String(singleMode));$('gridMode').setAttribute('aria-pressed',String(!singleMode));
  const current=document.querySelector('#content [data-id]');
  $('acceptNext').disabled=!active||reviewBusy||saving||singleFinished||!current||!byAnnotation[current.dataset.id]?.crop;
  $('rejectNext').disabled=!active||reviewBusy||saving||singleFinished||!current;
  $('reviewEnd').textContent=singleFinished?'ถึงรายการสุดท้ายแล้ว ใช้ปุ่มก่อนหน้าหรือเปลี่ยนตัวกรองเพื่อตรวจต่อ':'';
}
function render(){
  let items=[],size=60,make=annotationCard;
  const q=$('query').value.toLowerCase();
  if(tab==='crops'){items=filteredAnnotations();size=singleMode?1:60;}
  if(tab==='pairs'){items=data.pairs.filter(p=>!q||p.images.some(id=>JSON.stringify(byImage[id]).toLowerCase().includes(q)));size=20;make=pairCard;}
  if(tab==='conflicts'){
    items=[...data.before.annotation_conflicts.map(x=>({...x,kind:'annotation ของภาพซ้ำไม่ตรงกัน'})),...data.before.crop_label_conflicts.map(ids=>({kind:'crop เหมือนกันแต่ชื่อคลาสไม่ตรงกัน',images:[...new Set(ids.map(id=>byAnnotation[id].image_id))],annotations:ids}))];
    size=20;make=x=>`<article class="card"><b class="warn">${esc(x.kind)}</b>${x.images.map(imageMarkup).join('')}<pre>${esc(JSON.stringify(x,null,2))}</pre><p>แก้รุ่นหรือตัด annotation ที่ผิดในหน้าภาพรถ แล้วรัน pipeline ใหม่</p></article>`;
  }
  if(tab==='images'){items=data.images.filter(i=>!q||JSON.stringify(i).toLowerCase().includes(q));size=40;make=sourceCard;}
  page=Math.min(page,Math.max(0,Math.ceil(items.length/size)-1));
  $('position').textContent=tab==='crops'&&singleMode?`รูป ${items.length?page+1:0} / ${items.length}`:`${items.length} รายการ · หน้า ${page+1}/${Math.max(1,Math.ceil(items.length/size))}`;
  $('content').classList.toggle('single',tab==='crops'&&singleMode);
  $('content').innerHTML=items.slice(page*size,(page+1)*size).map(make).join('');
  if(!items.length)$('content').textContent='ไม่มีรายการในตัวกรองนี้';
  const confirmed=Object.values(review.annotations).filter(d=>d.confirmed&&!d.exclude).length;
  $('summary').textContent=`ต้นทาง ${data.before.totals.images} ภาพ / ${data.before.totals.annotation_lines} กล่อง · ชุดข้อมูลปัจจุบัน ${data.after.classification_crops} crop · บันทึกยืนยันรุ่น ${confirmed} รายการ การบันทึก review ยังไม่เปลี่ยน split จนกว่าจะรัน pipeline ใหม่`;
  $('groups').textContent=JSON.stringify(review.same_vehicle_groups,null,2);$('selection').textContent=[...selected].join(', ');
  if(workspace)$('summary').textContent=`ชุดตรวจแยก: ${data.before.totals.images} ภาพ / ${data.annotations.length} annotation · ยืนยันแล้ว ${confirmed} · ยังไม่รวมชุดเทรนหรือแบ่ง split · บันทึกผลลง ${reviewFilename}`;
  updateKeyboardControls();
}
function requireReason(card){
  const field=card.querySelector('[data-field=reason]');
  field.setCustomValidity(field.value.trim()?'':'กรุณากรอกเหตุผลก่อนบันทึก');field.reportValidity();
  return Boolean(field.value.trim());
}
function commitAnnotation(card,action,advance=false){
  if(reviewBusy||saving)return;
  if(!advance)singleFinished=false;
  const id=card.dataset.id,a=byAnnotation[id],before=filteredAnnotations().map(row=>row.annotation_id),oldIndex=before.indexOf(id);
  if(action==='save'){
    if(!a.crop)return;
    const name=card.querySelector('[data-field=class]').value,reason=card.querySelector('[data-field=reason]').value.trim(),previous=review.annotations[id];
    if(!classes.includes(name)){notice('กรุณาเลือกรุ่นให้ชัดเจนก่อนยืนยัน หรือกด M หากระบุไม่ได้');return;}
    if(!a.requires_class_selection&&name!==baseClass(a)&&!requireReason(card))return;
    review.annotations[id]={confirmed:true};
    if(name!==baseClass(a))review.annotations[id].canonical_class=name;
    if(a.requires_class_selection)review.annotations[id].reason=reason||'ผู้ตรวจระบุรุ่นจากภาพ';
    if(reason&&(!previous?.exclude||reason!==previous.reason||name!==baseClass(a)))review.annotations[id].reason=reason;
  }else if(action==='exclude'){
    const field=card.querySelector('[data-field=reason]');
    if(advance&&!field.value.trim())field.value='ผู้ตรวจเลือกไม่ใช้ภาพนี้';
    if(!requireReason(card))return;
    review.annotations[id]={exclude:true,reason:field.value.trim()};
  }else if(action==='reset')delete review.annotations[id];
  drafts.delete('ann:'+id);reviewBusy=true;mark();
  if(!advance)render();else updateKeyboardControls();
  try{
    stageDecision();
    if(advance){
      const after=filteredAnnotations().map(row=>row.annotation_id),surviving=new Set(after);
      const next=before.slice(oldIndex+1).find(key=>surviving.has(key));
      singleFinished=!next;
      page=next?after.indexOf(next):Math.max(0,Math.min(oldIndex,after.length-1));
      render();
    }
  }finally{reviewBusy=false;updateKeyboardControls();}
}
$('content').addEventListener('input',event=>{
  const card=event.target.closest('[data-id],[data-image],[data-pair]');if(!card)return;
  const reason=card.querySelector('[data-field=reason]').value;
  if(card.dataset.id)drafts.set('ann:'+card.dataset.id,{className:card.querySelector('[data-field=class]').value,reason});
  else if(card.dataset.image)drafts.set('image:'+card.dataset.image,{reason});
  else drafts.set('pair:'+card.dataset.pair,{decision:card.querySelector('[data-field=decision]').value,reason});
  card.querySelector('[data-field=reason]').setCustomValidity('');
  notice('แก้ตัวเลือกแล้ว กดปุ่มบันทึกผลตรวจของภาพหรือคู่ภาพนี้เพื่อยืนยัน');
});
$('content').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const action=button.dataset.action,card=button.closest('[data-id],[data-image],[data-pair]');
  if(card.dataset.id){
    const id=card.dataset.id;
    if(action==='select'){selected.has(id)?selected.delete(id):selected.add(id);render();return;}
    commitAnnotation(card,action);return;
  }else if(card.dataset.image){
    const id=card.dataset.image;
    if(action==='excludeImage'){
      if(!requireReason(card))return;
      review.images[id]={exclude:true,reason:card.querySelector('[data-field=reason]').value.trim()};
    }else delete review.images[id];
    drafts.delete('image:'+id);
  }else{
    const key=card.dataset.pair,decision=card.querySelector('[data-field=decision]').value;
    if(decision!=='pending'&&!requireReason(card))return;
    review.similar_pairs=review.similar_pairs.filter(p=>[...p.images].sort().join('|')!==key);
    if(decision!=='pending')review.similar_pairs.push({images:key.split('|'),decision,reason:card.querySelector('[data-field=reason]').value.trim()});
    drafts.delete('pair:'+key);
  }
  mark();render();stageDecision();
});
function navigate(delta){if(reviewBusy||saving)return;page=Math.max(0,page+delta);singleFinished=false;render();}
for(const [id,value]of [['cropsTab','crops'],['pairsTab','pairs'],['conflictsTab','conflicts'],['imagesTab','images']])$(id).onclick=()=>{if(reviewBusy||saving)return;tab=value;page=0;singleFinished=false;render();};
for(const id of ['classFilter','statusFilter','flagFilter','query'])$(id).oninput=()=>{if(reviewBusy||saving)return;page=0;singleFinished=false;render();};
$('previous').onclick=()=>navigate(-1);$('next').onclick=()=>navigate(1);
function setMode(single){if(reviewBusy||saving||singleMode===single)return;page=single?page*60:Math.floor(page/60);singleMode=single;singleFinished=false;render();}
$('singleMode').onclick=()=>setMode(true);$('gridMode').onclick=()=>setMode(false);
function quickDecision(action){
  if(tab!=='crops'||!singleMode||singleFinished||reviewBusy||saving)return;
  const card=document.querySelector('#content [data-id]');if(card)void commitAnnotation(card,action,true);
}
$('acceptNext').onclick=()=>quickDecision('save');$('rejectNext').onclick=()=>quickDecision('exclude');
document.addEventListener('keydown',event=>{
  if(tab!=='crops'||!singleMode||reviewBusy||saving||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  const editable='input,textarea,select,[contenteditable],[role=textbox]';
  if((event.target instanceof Element&&event.target.closest(editable))||document.activeElement?.closest(editable))return;
  const key=event.key.toLowerCase();
  if(key==='n'||event.code==='KeyN'){event.preventDefault();quickDecision('save');}
  else if(key==='m'||event.code==='KeyM'){event.preventDefault();quickDecision('exclude');}
  else if(event.key==='ArrowLeft'){event.preventDefault();navigate(-1);}
  else if(event.key==='ArrowRight'){event.preventDefault();navigate(1);}
});
$('clearSelection').onclick=()=>{selected.clear();render();};
$('group').onclick=()=>{
  if(selected.size<2){notice('เลือกอย่างน้อยสองกรอบที่ยืนยันว่าเป็นรถคันเดียวกันก่อน');return;}
  review.same_vehicle_groups.push([...selected].sort());selected.clear();mark();render();stageDecision();
};
$('importReview').onchange=async event=>{
  try{
    if((dirty||drafts.size)&&!confirm('แทนที่ผลตรวจที่ยังไม่บันทึกด้วยไฟล์ที่เลือกหรือไม่?'))return;
    const incoming=JSON.parse(await event.target.files[0].text());
    if(incoming.version!==1||!incoming.annotations||!incoming.images||!Array.isArray(incoming.same_vehicle_groups)||!Array.isArray(incoming.similar_pairs))throw Error('รูปแบบ review ไม่ถูกต้อง');
    if(Object.keys(incoming.annotations).some(id=>!byAnnotation[id])||Object.keys(incoming.images).some(id=>!byImage[id]))throw Error('ไฟล์มี ID ที่ไม่อยู่ในชุดข้อมูลนี้');
    for(const [id,d] of Object.entries(incoming.annotations))if(d.confirmed&&!d.exclude&&byAnnotation[id].requires_class_selection&&!classes.includes(d.canonical_class))throw Error('ผลตรวจต้องระบุรุ่นที่เลือกสำหรับชื่อกำกวม');
    review=incoming;drafts.clear();selected.clear();revision++;dirty=false;fileHandle=null;
    notice('นำเข้าผลตรวจแล้ว กดบันทึกไฟล์เพื่อเลือกไฟล์ที่จะเก็บผลตรวจต่อ');render();
  }catch(error){notice(error.message);}
};
$('exportReview').onclick=saveFile;$('downloadReview').onclick=downloadReview;
window.addEventListener('beforeunload',event=>{if(dirty||drafts.size){event.preventDefault();event.returnValue='';}});
render();
</script></html>'''
