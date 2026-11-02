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
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkMap — provisional motorcycle-family review</title>
<style>
body{font:15px system-ui;margin:0;background:#f3f5f8;color:#172238}header{padding:20px;background:#12233b;color:white}h1{font-size:23px;margin:0 0 8px}button,select,input{font:inherit;padding:7px;margin:3px;border:1px solid #a5b2c6;border-radius:5px}button{cursor:pointer;background:white}button:hover{background:#e2eaff}.bar{padding:10px;background:white;border-bottom:1px solid #ccd4df;position:sticky;top:0;z-index:2}main{padding:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(275px,1fr));gap:12px}.card{background:white;padding:12px;border:1px solid #ced5df;border-radius:8px;overflow-wrap:anywhere}.card img{width:100%;height:200px;object-fit:contain;background:#e9edf2}.card.selected{outline:3px solid #2563eb}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.muted{color:#536174;font-size:13px}.warn{color:#8e3400}.badge{display:inline-block;background:#fff0c9;padding:3px 6px;border-radius:4px}.hidden{display:none}a{color:#1454b5}pre{white-space:pre-wrap;font-size:12px}summary{cursor:pointer}#summary{padding:12px 0}#notice{color:#06498e}label{display:inline-block}#selection{max-height:80px;overflow:auto}textarea{width:95%;min-height:55px}
</style>
<header><h1>ParkMap · Motorcycle-family dataset review</h1><b class="badge warn">PROVISIONAL — labels and vehicle identities need human review</b><p>No training performed. Crops preserve supplied pixels; source images may already be stretched.</p></header>
<div class="bar">
<button id="cropsTab">Crops / labels</button><button id="pairsTab">Similar pairs</button><button id="conflictsTab">Duplicate conflicts</button><button id="imagesTab">Source images / errors</button>
<label>Import review <input id="importReview" type="file" accept=".json"></label><button id="exportReview">Download review.json</button><br>
<select id="classFilter"><option value="">All classes</option></select>
<select id="statusFilter"><option value="">All dispositions</option></select>
<select id="flagFilter"><option value="">All crops</option><option value="unconfirmed">Unconfirmed / ambiguous</option><option value="flagged">Unusual boxes / invalid</option><option value="excluded">Excluded by current review</option></select>
<input id="query" placeholder="Search class, filename, ID" size="28"><button id="previous">Previous</button><button id="next">Next</button><span id="position"></span>
<details><summary>Group confirmed views of the same physical motorcycle</summary><p>Select annotation cards, then group. This links their entire source-image groups before splitting; it does not merge labels.</p><div id="selection"></div><button id="group">Group selected annotations</button><button id="clearSelection">Clear selection</button><pre id="groups"></pre></details>
<div id="notice">Decisions stay in page memory until downloaded. Save review.json before closing or reloading.</div></div>
<main><div id="summary"></div><div id="content" class="grid"></div></main>
<script id="data" type="application/json">__PAYLOAD__</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent),byImage=Object.fromEntries(data.images.map(i=>[i.image_id,i]));
const classes=Object.keys(data.after.classes),selected=new Set();let review={version:1,annotations:{},images:{},same_vehicle_groups:[],similar_pairs:[],...data.review},tab='crops',page=0,dirty=false;
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mark(){dirty=true;$('notice').textContent='Unsaved review decisions — download review.json to keep them.';}
function options(values,current){return values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('')}
$('classFilter').innerHTML+=options(classes);$('statusFilter').innerHTML+=options([...new Set(data.annotations.map(a=>a.disposition))].sort());
function imageMarkup(id){const i=byImage[id];return `<div>${i.preview?`<a href="${esc(i.preview)}" target="_blank"><img loading="lazy" src="${esc(i.preview)}"></a>`:'Unreadable image'}<div class="muted">${esc(i.source_dataset)} · ${esc(i.source_image)}<br>ID: ${esc(id)}<br>${esc(i.group_id)}</div></div>`}
function annotationCard(a){const decision=review.annotations[a.annotation_id]||{};return `<article class="card ${selected.has(a.annotation_id)?'selected':''}" data-id="${esc(a.annotation_id)}">${a.crop?`<a href="${esc(a.crop.path)}" target="_blank"><img loading="lazy" src="${esc(a.crop.path)}"></a>`:'No valid crop'}<b>${esc(a.canonical_class||a.original_class||'Invalid annotation')}</b><div class="muted">${esc(a.annotation_id)}<br>${esc(a.source_image)} · original ${esc(a.original_split)}</div><p>${esc(a.disposition)} · ${esc(a.review_flags.join(', '))}<br><span class="warn">${esc(a.issues.join(', '))}</span></p><label><input type="checkbox" data-action="select" ${selected.has(a.annotation_id)?'checked':''}>Select for same-vehicle grouping</label><br><label><input type="checkbox" data-action="confirm" ${decision.confirmed?'checked':''}>Human-confirmed label</label><label><input type="checkbox" data-action="exclude" ${decision.exclude?'checked':''}>Exclude</label><br><select data-action="class">${options(classes,decision.canonical_class||a.canonical_class)}</select><input data-action="reason" placeholder="Reason required for exclusion/correction" value="${esc(decision.reason||'')}"><details><summary>Source image, box and provenance</summary>${imageMarkup(a.image_id)}<pre>${esc(JSON.stringify(a,null,2))}</pre></details></article>`}
function pairCard(pair){const key=[...pair.images].sort().join('|'),decision=review.similar_pairs.find(p=>[...p.images].sort().join('|')===key)||{};return `<article class="card" data-pair="${esc(key)}"><b>dHash distance ${pair.dhash_distance} — candidate only</b><div class="pair">${pair.images.map(imageMarkup).join('')}</div><p>May be unrelated. Never automatically removed or grouped.</p><select data-action="pairDecision">${options(['pending','distinct','same_vehicle_grouped','uncertain'],decision.decision||'pending')}</select><input data-action="pairReason" placeholder="Review reason" value="${esc(decision.reason||'')}"></article>`}
function render(){let items=[],size=60,make=annotationCard;const q=$('query').value.toLowerCase(),c=$('classFilter').value,s=$('statusFilter').value,f=$('flagFilter').value;
if(tab==='crops'){items=data.annotations.filter(a=>(!c||a.canonical_class===c)&&(!s||a.disposition===s)&&(!q||JSON.stringify(a).toLowerCase().includes(q))&&(!f||(f==='unconfirmed'&&!(review.annotations[a.annotation_id]?.confirmed||a.label_confirmed))||(f==='flagged'&&(a.issues.length||a.review_flags.length))||(f==='excluded'&&review.annotations[a.annotation_id]?.exclude)));}
if(tab==='pairs'){items=data.pairs.filter(p=>!q||p.images.some(id=>JSON.stringify(byImage[id]).toLowerCase().includes(q)));size=20;make=pairCard;}
if(tab==='conflicts'){items=[...data.before.annotation_conflicts.map(x=>({...x,kind:'Image duplicate annotation conflict'})),...data.before.crop_label_conflicts.map(ids=>({kind:'Identical crop with conflicting class',images:[...new Set(ids.map(id=>data.annotations.find(a=>a.annotation_id===id).image_id))],annotations:ids}))];size=20;make=x=>`<article class="card"><b class="warn">${esc(x.kind)}</b>${x.images.map(imageMarkup).join('')}<pre>${esc(JSON.stringify(x,null,2))}</pre><p>Exclude an incorrect source image in Source images, or correct/exclude individual annotations in Crops. Rerun to resolve.</p></article>`;}
if(tab==='images'){items=data.images.filter(i=>!q||JSON.stringify(i).toLowerCase().includes(q));size=40;make=i=>`<article class="card" data-image="${esc(i.image_id)}">${imageMarkup(i.image_id)}<p class="warn">${esc(i.issues.join(', '))}</p><label><input type="checkbox" data-action="excludeImage" ${review.images[i.image_id]?.exclude?'checked':''}>Exclude source image</label><input data-action="imageReason" placeholder="Reason" value="${esc(review.images[i.image_id]?.reason||'')}"></article>`;}
page=Math.min(page,Math.max(0,Math.ceil(items.length/size)-1));$('position').textContent=`${items.length} items · page ${page+1}/${Math.max(1,Math.ceil(items.length/size))}`;$('content').innerHTML=items.slice(page*size,(page+1)*size).map(make).join('');$('summary').textContent=`Input ${data.before.totals.images} images / ${data.before.totals.annotation_lines} annotation lines. Output ${data.after.classification_crops} crops. ${data.after.unconfirmed_included_annotations} unconfirmed included labels. Known hash/group cross-split counts: ${JSON.stringify(data.after.leakage)}. Counts are not distinct vehicles.`;$('groups').textContent=JSON.stringify(review.same_vehicle_groups,null,2);$('selection').textContent=[...selected].join(', ');
}
$('content').addEventListener('change',e=>{const action=e.target.dataset.action;if(!action)return;const card=e.target.closest('[data-id]');if(card){const id=card.dataset.id;if(action==='select'){e.target.checked?selected.add(id):selected.delete(id);render();return}const d=review.annotations[id]||{};if(action==='confirm')d.confirmed=e.target.checked;if(action==='exclude')d.exclude=e.target.checked;if(action==='reason')d.reason=e.target.value;if(action==='class')d.canonical_class=e.target.value;review.annotations[id]=d;mark();return}
const image=e.target.closest('[data-image]');if(image){const id=image.dataset.image,d=review.images[id]||{};if(action==='excludeImage')d.exclude=e.target.checked;if(action==='imageReason')d.reason=e.target.value;review.images[id]=d;mark();return}
const pair=e.target.closest('[data-pair]');if(pair){const ids=pair.dataset.pair.split('|');let d=review.similar_pairs.find(p=>[...p.images].sort().join('|')===pair.dataset.pair);if(!d){d={images:ids,decision:'uncertain',reason:''};review.similar_pairs.push(d)}if(action==='pairDecision')d.decision=e.target.value==='pending'?'uncertain':e.target.value;if(action==='pairReason')d.reason=e.target.value;mark();}});
for(const [id,value]of [['cropsTab','crops'],['pairsTab','pairs'],['conflictsTab','conflicts'],['imagesTab','images']])$(id).onclick=()=>{tab=value;page=0;render()};for(const id of ['classFilter','statusFilter','flagFilter','query'])$(id).oninput=()=>{page=0;render()};$('previous').onclick=()=>{page=Math.max(0,page-1);render()};$('next').onclick=()=>{page++;render()};$('clearSelection').onclick=()=>{selected.clear();render()};$('group').onclick=()=>{if(selected.size<2){alert('Select at least two annotations for confirmed views of the same motorcycle.');return}review.same_vehicle_groups.push([...selected].sort());selected.clear();mark();render()};
$('importReview').onchange=async e=>{try{const incoming=JSON.parse(await e.target.files[0].text());if(incoming.version!==1||!incoming.annotations||!incoming.images||!Array.isArray(incoming.same_vehicle_groups)||!Array.isArray(incoming.similar_pairs))throw Error('Unsupported review schema');review=incoming;dirty=false;$('notice').textContent='Review imported. Pipeline validates all IDs and decisions when rerun.';render()}catch(error){alert(error.message)}};
$('exportReview').onclick=()=>{const blob=new Blob([JSON.stringify(review,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='review.json';a.click();URL.revokeObjectURL(url);dirty=false;$('notice').textContent='Review downloaded. Rerun the Python pipeline with --review <file> to apply it.'};window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});render();
</script></html>'''
