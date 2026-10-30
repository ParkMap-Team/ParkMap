'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Plus, Redo2, Save, Send, Trash2, Undo2, Upload } from 'lucide-react';
import { LANDMARK_NAMES, modelBounds, moveLandmark, newLandmark, roiObjects, replaceEditorObject, isRoiId, adoptRoiOutline } from '../../lib/lotModelEditor';
import type { LandmarkKind, LotLandmark, LotModelDefinition, LotModelDraftState, SiteSummary } from '../../types/lotModel';
import { LotModelCanvas } from './LotModelCanvas';
import { LandmarkProperties } from './LandmarkProperties';
import { RoiProperties } from './RoiProperties';

const LotModelPreview = lazy(() => import('./LotModelPreview').then((module) => ({ default: module.LotModelPreview })));
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const identical = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function definitionOnly(definition: LotModelDefinition): LotModelDefinition {
  return { schema_version: definition.schema_version ?? 1, outline: definition.outline, parking_areas: definition.parking_areas, landmarks: definition.landmarks ?? [] };
}

async function request<T>(operation: string, site = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ op: operation, ...(site ? { site } : {}) });
  const response = await fetch(`/api/lot-model-editor?${query}`, {
    method, signal, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : undefined;
    if (typeof detail === 'string' && detail.includes('must lie inside the lot outline')) {
      throw new Error('ROI บางส่วนอยู่นอกขอบลานสีเทา เลือก ROI แล้วกด “ใช้ ROI นี้เป็นขอบลาน” หากต้องการให้ขอบลานตรงกับ ROI ที่ปรับ หรือย้าย/ลดขนาด ROI ให้กลับเข้าขอบลานเดิม');
    }
    throw new Error(Array.isArray(detail) ? detail.slice(0, 3).map((error: { msg: string; loc?: (string | number)[] }) => `${error.loc?.slice(1).join('.') ?? ''}: ${error.msg}`).join(' · ')
      : typeof detail === 'string' ? detail : `ไม่สามารถทำรายการได้ (${response.status})`);
  }
  return payload as T;
}

interface History { past: LotModelDefinition[]; present: LotModelDefinition | null; future: LotModelDefinition[] }

export function LotModelEditor() {
  const [history, setHistory] = useState<History>({ past: [], present: null, future: [] });
  const [template, setTemplate] = useState<LotModelDefinition | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [siteId, setSiteId] = useState('');
  const [server, setServer] = useState<LotModelDraftState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<LandmarkKind>('TREE');
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [editRoi, setEditRoi] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const model = history.present;
  const landmarks = model?.landmarks ?? [];
  const selected = landmarks.find((landmark) => landmark.landmark_id === selectedId);
  const rois = model ? roiObjects(model) : [];
  const selectedRoi = editRoi ? rois.find((roi) => roi.landmark_id === selectedId) : undefined;
  const dirty = !!model && !identical(model, server?.definition ?? template);
  const stale = !!server && server.base_version !== server.active_version;
  const estimated = landmarks.filter((landmark) => landmark.measurement_source !== 'MEASURED').length;

  const replace = useCallback((definition: LotModelDefinition) => {
    setHistory({ past: [], present: definitionOnly(definition), future: [] }); setSelectedId(null);
  }, []);

  const commit = useCallback((before: LotModelDefinition, after: LotModelDefinition) => {
    if (identical(before, after)) return;
    setHistory((current) => ({ past: [...current.past, before].slice(-50), present: after, future: [] })); setNotice('');
  }, []);

  const undo = useCallback(() => setHistory((current) => current.present && current.past.length ? {
    past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future],
  } : current), []);
  const redo = useCallback(() => setHistory((current) => current.present && current.future.length ? {
    past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1),
  } : current), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [initial, available] = await Promise.all([
          request<LotModelDefinition>('template', '', 'GET', undefined, controller.signal),
          request<SiteSummary[]>('sites', '', 'GET', undefined, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setTemplate(definitionOnly(initial)); setSites(available); replace(initial);
        const chosen = available.find((site) => site.site_id === 'sripatum') ?? available[0];
        if (chosen) {
          setSiteId(chosen.site_id);
          const draft = await request<LotModelDraftState>('draft', chosen.site_id, 'GET', undefined, controller.signal);
          if (controller.signal.aborted) return;
          setServer(draft); replace(draft.definition);
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลดแผนผังไม่ได้'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [replace]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (busy || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      if ((event.target as HTMLElement).closest('input,textarea,select')) return;
      event.preventDefault(); if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [busy, undo, redo]);

  async function loadDraft(id: string) {
    if (dirty && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการโหลดฉบับร่างใหม่หรือไม่?')) return;
    setBusy(true); setError(''); setNotice(''); setSiteId(id); setServer(null);
    try { const draft = await request<LotModelDraftState>('draft', id); setServer(draft); replace(draft.definition); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'โหลดฉบับร่างไม่ได้'); }
    finally { setBusy(false); }
  }

  async function loadActive() {
    if (dirty && !window.confirm('ใช้ข้อมูลที่ LIFF แสดงแทนการแก้ไขที่ยังไม่บันทึกหรือไม่?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const [draft, active] = await Promise.all([
        request<LotModelDraftState>('draft', siteId), request<LotModelDefinition & { version: number }>('active', siteId),
      ]);
      setServer({ ...draft, base_version: active.version }); replace(active);
      setNotice('โหลดเวอร์ชันที่ LIFF ใช้งานแล้ว ปรับแก้และบันทึกเป็นฉบับร่างได้');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'โหลดเวอร์ชันใช้งานไม่ได้'); }
    finally { setBusy(false); }
  }

  function editLandmark(landmark: LotLandmark) {
    if (model && !busy) commit(model, replaceEditorObject(model, landmark));
  }

  function add() {
    if (!model) return;
    try {
      const bounds = modelBounds({ ...model, landmarks: [] });
      const landmark = newLandmark(model, newKind, { x_m: (bounds.minX + bounds.maxX) / 2, y_m: (bounds.minY + bounds.maxY) / 2 });
      commit(model, { ...model, landmarks: [...landmarks, landmark] }); setSelectedId(landmark.landmark_id); setMode('2d');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'เพิ่มวัตถุไม่ได้'); }
  }

  function duplicate() {
    if (!model || !selected) return;
    try {
      const copy = moveLandmark(selected, { x_m: selected.position.x_m + 2, y_m: selected.position.y_m + 2 });
      copy.landmark_id = newLandmark(model, selected.kind, copy.position).landmark_id;
      copy.measurement_source = 'ESTIMATED'; copy.name = selected.name ? `${selected.name} สำเนา`.slice(0, 40) : null;
      commit(model, { ...model, landmarks: [...landmarks, copy] }); setSelectedId(copy.landmark_id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ทำสำเนาไม่ได้'); }
  }

  async function save() {
    if (!model || !server || busy || stale || !form.current?.reportValidity()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const draft = await request<LotModelDraftState>('draft', siteId, 'PUT', { definition: model, expected_revision: server.revision, base_version: server.base_version });
      setServer(draft); replace(draft.definition); setNotice('บันทึกฉบับร่างแล้ว LIFF ยังใช้เวอร์ชันเดิม');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'บันทึกไม่ได้'); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!server || busy || dirty || stale || !form.current?.reportValidity()) return;
    const name = sites.find((site) => site.site_id === siteId)?.name ?? siteId;
    if (!window.confirm(`เปิดใช้ฉบับร่างของ ${name} ใน LIFF หรือไม่?\nแผนผังที่นักศึกษาเห็นจะเปลี่ยนเป็นฉบับนี้\nเมื่อมี ROI จาก calibration รถจะย้าย/หมุนตาม ROI ทั้งรูป หากเปลี่ยนขนาดหรือรูปทรง ต้องตรวจ calibration ใหม่`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const published = await request<LotModelDraftState>('activate', siteId, 'POST', { expected_revision: server.revision, base_version: server.base_version });
      setServer(published); replace(published.definition); setNotice(`เปิดใช้เวอร์ชัน ${published.active_version} แล้ว โหลดหน้า LIFF ใหม่เพื่อดูผล`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'เปิดใช้งานไม่ได้'); }
    finally { setBusy(false); }
  }

  function download() {
    if (!model || !form.current?.reportValidity()) return;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(model, null, 2)}\n`], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'spu-cam-01-lot-model.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file: File | undefined) {
    if (!file || !model) return;
    if (file.size > 1024 * 1024) { setError('ไฟล์ต้องมีขนาดไม่เกิน 1 MB'); return; }
    if (dirty && !window.confirm('แทนที่การแก้ไขที่ยังไม่บันทึกด้วยไฟล์นี้หรือไม่?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('ไฟล์ JSON ไม่ถูกต้อง'); }
      const imported = definitionOnly(await request<LotModelDefinition>('validate', '', 'POST', parsed));
      if (!identical(imported.outline, model.outline) && !(imported.parking_areas.length === 1 && identical(imported.outline, imported.parking_areas[0].polygon))) {
        throw new Error('ใช้ขอบลานเดิม หรือขอบลานที่ตรงกับ ROI เดียวในไฟล์เท่านั้น');
      }
      commit(model, imported); setSelectedId(null); setMode('2d'); setNotice('นำเข้าแล้ว ยังไม่บันทึกหรือเปิดใช้งาน');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'นำเข้าไม่ได้'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  return <form ref={form} onSubmit={(event) => event.preventDefault()} className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-blue-600">เครื่องมือผู้ดูแล</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">แผนผังสถานที่</h1>
        <p className="mt-2 text-sm text-slate-500">วางต้นไม้ ถนน และทางเดินตามขนาดในโมเดล แล้วตรวจทานก่อนเปิดใช้ใน LIFF</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!model || busy} onClick={download}><Download size={16} />ส่งออก JSON</button>
        <button type="button" className={button} disabled={!model || busy} onClick={() => fileInput.current?.click()}><Upload size={16} />นำเข้า</button>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" aria-label="นำเข้าไฟล์แผนผัง" onChange={(event) => void importFile(event.target.files?.[0])} />
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium text-slate-500">สถานที่
          <select value={siteId} disabled={busy || !sites.length} className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            onChange={(event) => void loadDraft(event.target.value)}>
            {!sites.length && <option value="">ยังไม่มีสถานที่</option>}{sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.name}</option>)}
          </select>
        </label>
        {server && <span className="text-xs text-slate-500">LIFF: {server.active_version ? `เวอร์ชัน ${server.active_version}` : 'ยังไม่เปิดใช้'} · {server.revision ? `ฉบับร่าง ${server.revision}` : 'ฉบับตั้งต้น'}{dirty ? ' · มีการแก้ไข' : ''}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !server || stale} onClick={() => void save()}><Save size={16} />บันทึกฉบับร่าง</button>
        <button type="button" className={`${button} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || !server?.revision || dirty || stale || server.is_published}
          onClick={() => void activate()}><Send size={16} />เปิดใช้ใน LIFF</button>
      </div>
    </div>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}{!model && <button type="button" className="ml-3 underline" onClick={() => window.location.reload()}>ลองโหลดใหม่</button>}</div>}
    {notice && <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</p>}
    {stale && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">โมเดลที่ใช้งานเปลี่ยนหลังบันทึกฉบับนี้ กรุณาโหลดเวอร์ชัน LIFF ก่อนแก้ไขต่อ หรือส่งออกฉบับนี้เก็บไว้ก่อน</p>}

    {model ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>ข้อมูลตั้งต้น: spu-cam-01-lot-model.json · {landmarks.length}/100 วัตถุ · {estimated} รายการเป็นค่าประมาณ</span>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !siteId} className="underline disabled:opacity-40" onClick={() => void loadDraft(siteId)}>โหลดฉบับร่างใหม่</button>
          <button type="button" disabled={busy || !server?.active_version} className="underline disabled:opacity-40" onClick={() => void loadActive()}>โหลดเวอร์ชัน LIFF</button>
          <button type="button" disabled={busy || !template} className="underline disabled:opacity-40" onClick={() => {
            if (!template || (dirty && !window.confirm('แทนที่การแก้ไขที่ยังไม่บันทึกด้วยข้อมูลตั้งต้นหรือไม่?'))) return;
            commit(model, template); setSelectedId(null);
          }}>ใช้ข้อมูลตั้งต้น</button>
          {!!server?.active_version && <a href={`http://localhost:3001/sites/${encodeURIComponent(siteId)}`} target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline">ดูใน LIFF ↗</a>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(['2d', '3d'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`} onClick={() => setMode(value)}>{value === '2d' ? 'แก้ไข 2D' : 'ตัวอย่าง 3D'}</button>)}
        </div>
        <div className="flex gap-2"><button type="button" className={button} aria-label="ย้อนกลับ" disabled={busy || !history.past.length} onClick={undo}><Undo2 size={16} /></button>
          <button type="button" className={button} aria-label="ทำซ้ำ" disabled={busy || !history.future.length} onClick={redo}><Redo2 size={16} /></button></div>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <input type="checkbox" checked={editRoi} disabled={busy} onChange={(event) => {
          setEditRoi(event.target.checked); if (isRoiId(selectedId)) setSelectedId(null); setMode('2d');
        }} />แก้ขอบเขต ROI — ลากย้าย ปรับมุม และหมุนเป็นองศา
      </label>
      {editRoi && <div className="flex flex-wrap gap-2" aria-label="เลือกพื้นที่ ROI">{rois.map((roi) => <button type="button" key={roi.landmark_id}
        disabled={busy} aria-pressed={selectedId === roi.landmark_id} onClick={() => { setSelectedId(roi.landmark_id); setMode('2d'); }}
        className={`${button} ${selectedId === roi.landmark_id ? 'border-blue-500 text-blue-700' : ''}`}>{roi.name}</button>)}</div>}
      <div className="grid items-start gap-4 xl:grid-cols-[210px_minmax(0,1fr)_280px]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="px-1 pb-3 text-sm font-semibold text-slate-800">วัตถุในแผนผัง</h2>
          <div className="flex gap-2 pb-3"><select aria-label="ประเภทวัตถุใหม่" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs" value={newKind} disabled={busy} onChange={(event) => setNewKind(event.target.value as LandmarkKind)}>
            {Object.entries(LANDMARK_NAMES).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
          </select><button type="button" className={button} aria-label="เพิ่มวัตถุ" disabled={busy || landmarks.length >= 100} onClick={add}><Plus size={16} /></button></div>
          <div className="max-h-[530px] space-y-1 overflow-y-auto">{landmarks.map((landmark) => <button type="button" key={landmark.landmark_id} disabled={busy}
            className={`w-full rounded-xl px-3 py-2 text-left ${selectedId === landmark.landmark_id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'}`} onClick={() => setSelectedId(landmark.landmark_id)}>
            <span className="block truncate text-xs font-medium text-slate-700">{landmark.name || LANDMARK_NAMES[landmark.kind]}</span><span className="block truncate text-[10px] text-slate-400">{landmark.landmark_id}</span>
          </button>)}</div>
        </aside>
        <div className="order-first min-w-0 xl:order-none">
          {mode === '2d' ? <LotModelCanvas model={model} selectedId={selectedId} disabled={busy} editRoi={editRoi} onSelect={setSelectedId}
            onPreview={(next) => setHistory((current) => ({ ...current, present: next }))} onCommit={commit} />
            : <Suspense fallback={<div className="flex h-[650px] items-center justify-center rounded-2xl border bg-white text-sm text-slate-500">กำลังโหลดตัวอย่าง 3D…</div>}><LotModelPreview model={model} /></Suspense>}
        </div>
        <aside className="space-y-3">
          {selectedRoi ? <RoiProperties key={selectedRoi.landmark_id} object={selectedRoi} disabled={busy} onChange={editLandmark}
            onUseAsOutline={model.parking_areas.length === 1 ? () => { commit(model, adoptRoiOutline(model, selectedRoi.landmark_id)); setError(''); setNotice('ปรับขอบลานให้ตรงกับ ROI แล้ว กดบันทึกฉบับร่างได้'); } : undefined} /> : selected ? <>
            <LandmarkProperties key={selected.landmark_id} landmark={selected} disabled={busy} onChange={editLandmark} />
            <div className="flex gap-2"><button type="button" className={`${button} flex-1`} disabled={busy || landmarks.length >= 100} onClick={duplicate}><Copy size={15} />ทำสำเนา</button>
              <button type="button" className={`${button} text-rose-700`} disabled={busy} onClick={() => {
                commit(model, { ...model, landmarks: landmarks.filter((landmark) => landmark.landmark_id !== selectedId) }); setSelectedId(null);
              }}><Trash2 size={15} />ลบ</button></div>
          </> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-500">เลือกวัตถุจากแผนผังหรือรายการ เพื่อกรอกตำแหน่ง ขนาดเป็นเมตร และแหล่งข้อมูล</div>}
          <p className="px-2 text-xs leading-relaxed text-slate-400">ค่าที่ประมาณจากภาพให้ใช้ “ประมาณ” จนกว่าจะวัดจริง การแก้ ROI ไม่ได้ปรับ calibration ของกล้องให้อัตโนมัติ</p>
        </aside>
      </div>
      {!sites.length && <p className="text-sm text-slate-500">ยังไม่มีสถานที่ในฐานข้อมูล สามารถแก้ไขและส่งออกได้ เมื่อผู้ดูแลลงทะเบียนสถานที่และพื้นที่กล้องแล้วจึงบันทึกและเปิดใช้งานได้</p>}
    </> : busy ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">กำลังโหลดข้อมูลตั้งต้น…</div> : null}
  </form>;
}
