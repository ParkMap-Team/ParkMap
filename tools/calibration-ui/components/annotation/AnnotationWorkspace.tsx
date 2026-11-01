'use client';

import { useEffect, useRef, useState } from 'react';
import { annotationRequest, type AnnotationSample, type LabelBox, type LabelPoint, type MotorcycleLabel } from '../../lib/annotationEditor';
import { NumberField } from '../lot-model/LandmarkProperties';
import { AnnotationCanvas } from './AnnotationCanvas';

const button = 'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900';

function GroundPointFields({ value, width, height, onChange }: { value: LabelPoint | null; width: number; height: number; onChange: (point: LabelPoint) => void }) {
  const [x, setX] = useState(value ? String(value.x * width) : '');
  const [y, setY] = useState(value ? String(value.y * height) : '');
  const commit = () => {
    if (x !== '' && y !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && Number(x) >= 0 && Number(x) <= width && Number(y) >= 0 && Number(y) <= height) onChange({ x: Number(x) / width, y: Number(y) / height });
  };
  return <div className="grid grid-cols-2 gap-2">
    <label className="text-xs text-slate-600">จุดพื้น X (px)<input className={input} type="number" min={0} max={width} step="any" required={y !== ''} value={x} onChange={(e) => setX(e.target.value)} onBlur={commit} /></label>
    <label className="text-xs text-slate-600">จุดพื้น Y (px)<input className={input} type="number" min={0} max={height} step="any" required={x !== ''} value={y} onChange={(e) => setY(e.target.value)} onBlur={commit} /></label>
  </div>;
}

export function AnnotationWorkspace() {
  const [datasetInput, setDatasetInput] = useState('spu-motorcycles');
  const [dataset, setDataset] = useState('');
  const [samples, setSamples] = useState<AnnotationSample[]>([]);
  const [current, setCurrent] = useState<AnnotationSample | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<MotorcycleLabel[][]>([]);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = current?.annotations.find((label) => label.id === selectedId);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function select(sample: AnnotationSample | null) {
    if (dirty && !window.confirm('มี label ที่ยังไม่บันทึก ต้องการเปลี่ยนภาพหรือไม่?')) return;
    setCurrent(sample); setDirty(false); setSelectedId(null); setHistory([]); setError('');
  }
  async function load() {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(datasetInput)) { setError('ชื่อชุดข้อมูลใช้ a-z, 0-9 และขีดกลาง ไม่เกิน 63 ตัว'); return; }
    if (dirty && !window.confirm('มี label ที่ยังไม่บันทึก ต้องการโหลดใหม่หรือไม่?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await annotationRequest<AnnotationSample[]>(datasetInput, 'samples');
      setDataset(datasetInput); setSamples(data); setCurrent(data[0] ?? null); setDirty(false); setHistory([]); setSelectedId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'โหลดไม่ได้'); }
    finally { setBusy(false); }
  }
  function labels(next: MotorcycleLabel[]) {
    if (!current || busy) return;
    setHistory((past) => [...past, current.annotations].slice(-50));
    setCurrent({ ...current, annotations: next, reviewed: false }); setDirty(true); setNotice('');
  }
  function metadata(next: Partial<AnnotationSample>) {
    if (current) { setCurrent({ ...current, ...next, reviewed: false }); setDirty(true); setNotice(''); }
  }
  function changeBox(next: LabelBox) {
    if (current && selected) labels(current.annotations.map((label) => label.id === selected.id ? { ...label, bbox: next } : label));
  }
  function changePoint(point: LabelPoint | null) {
    if (current && selected) labels(current.annotations.map((label) => label.id === selected.id ? { ...label, ground_point: point } : label));
  }
  async function upload(files: FileList | null) {
    if (!files || !dataset) return;
    if (dirty && !window.confirm('มี label ที่ยังไม่บันทึก ต้องการเปลี่ยนภาพหรือไม่?')) return;
    setBusy(true); setError(''); setNotice('');
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: ขนาดเกิน 25 MB`);
        const body = new FormData(); body.set('image', file);
        const uploaded = await annotationRequest<AnnotationSample>(dataset, 'upload', 'POST', undefined, body);
        setSamples((previous) => [...previous.filter((s) => s.id !== uploaded.id), uploaded]);
        setCurrent(uploaded); setSelectedId(null); setHistory([]); setDirty(false); count++;
      }
      setNotice(`เพิ่ม ${count} ภาพแล้ว รูปถูกปรับ orientation และเก็บเป็น PNG สำหรับ label`);
    } catch (cause) { setError(`${count ? `เพิ่มสำเร็จ ${count} ภาพ · ` : ''}${cause instanceof Error ? cause.message : 'อัปโหลดไม่ได้'}`); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function save() {
    if (!current || !form.current?.reportValidity()) return;
    setBusy(true); setError('');
    try {
      const saved = await annotationRequest<AnnotationSample>(dataset, 'save', 'PUT', current.id, {
        expected_revision: current.revision, session: current.session, split: current.split, reviewed: current.reviewed, annotations: current.annotations,
      });
      setSamples((items) => items.map((item) => item.id === saved.id ? saved : item)); setCurrent(saved); setDirty(false); setHistory([]); setNotice('บันทึก label แล้ว เปิดกลับมาแก้ต่อได้');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'บันทึกไม่ได้'); }
    finally { setBusy(false); }
  }
  async function detect() {
    if (!current || (current.annotations.length && !window.confirm('ใช้กรอบจาก YOLO แทนกรอบบนภาพนี้หรือไม่? จุดพื้นและสถานะถูกบังต้องตรวจใหม่')) || !form.current?.reportValidity()) return;
    setBusy(true); setError('');
    try {
      const proposed = await annotationRequest<MotorcycleLabel[]>(dataset, 'detect', 'POST', current.id);
      setHistory((past) => [...past, current.annotations].slice(-50));
      setCurrent({ ...current, annotations: proposed, reviewed: false }); setDirty(true); setSelectedId(proposed[0]?.id ?? null);
      setNotice(`YOLO เสนอ ${proposed.length} กรอบ ยังไม่ใช่ label ที่ยืนยันแล้ว ตรวจรถที่พลาด จุดพื้น และสถานะถูกบังให้ครบก่อนส่งออก`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ตรวจจับไม่ได้'); }
    finally { setBusy(false); }
  }
  async function exportData() {
    if (!dataset || dirty) return;
    setBusy(true); setError('');
    try {
      const result = await annotationRequest<{ path: string; counts: Record<string, number>; ready_for_training: boolean }>(dataset, 'export', 'POST');
      setNotice(`ส่งออกแล้ว: ${result.path} · train ${result.counts.train} / val ${result.counts.val} / test ${result.counts.test}${result.ready_for_training ? '' : ' · ยังมี split ว่าง ต้องเตรียมครบก่อนฝึก'}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ส่งออกไม่ได้'); }
    finally { setBusy(false); }
  }

  return <form ref={form} onSubmit={(event) => event.preventDefault()} className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-slate-950">Label รถจักรยานยนต์</h1><p className="mt-2 text-sm text-slate-500">กรอบรถ · จุดที่ล้อสัมผัสพื้นใกล้กล้องที่สุด · สถานะถูกบัง — ตรวจด้วยคนก่อนส่งออก</p></div>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 shadow-sm">
      <label className="text-xs text-slate-600">ชื่อชุดข้อมูล<input aria-label="ชื่อชุดข้อมูล" className={input} value={datasetInput} maxLength={63} disabled={busy} onChange={(e) => setDatasetInput(e.target.value)} /></label>
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>เปิดชุดข้อมูล</button>
      <button type="button" className={button} disabled={busy || !dataset} onClick={() => fileInput.current?.click()}>เพิ่มรูป</button>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="เลือกรูปสำหรับ label" onChange={(event) => void upload(event.target.files)} />
      <button type="button" className={button} disabled={busy || !dataset || !samples.length || dirty} onClick={() => void exportData()}>ส่งออก YOLO + JSON</button>
      {dataset && <span className="text-xs text-slate-500">ชุดที่เปิด: {dataset} · {samples.length} ภาพ</span>}
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
    <p className="text-xs leading-relaxed text-slate-500">ภาพถูกเก็บบนเครื่องผู้ดูแลใน dataset workspace ไม่ใช่การอัปเดตสถานะจอด · รอบถ่ายเดียวกันต้องอยู่ split เดียว · หากมองไม่เห็นจุดสัมผัสพื้นให้คงเป็น “ไม่ยืนยัน” ไม่เดาตำแหน่ง</p>
    {!dataset ? <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-500">ตั้งชื่อชุดข้อมูลแล้วกด “เปิดชุดข้อมูล” เพื่อเริ่ม</div> : <div className="grid items-start gap-4 xl:grid-cols-[180px_minmax(0,1fr)_280px]">
      <aside className="max-h-[760px] space-y-1 overflow-y-auto rounded-2xl border bg-white p-2" aria-label="รายการภาพ">
        {!samples.length && <p className="p-3 text-xs text-slate-500">ยังไม่มีภาพ กดเพิ่มรูป</p>}
        {samples.map((sample) => <button key={sample.id} type="button" disabled={busy} onClick={() => select(sample)} className={`w-full rounded-lg p-3 text-left ${current?.id === sample.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
          <span className="block truncate text-xs font-medium text-slate-800">{sample.filename}</span><span className="text-[10px] text-slate-500">{sample.annotations.length} กรอบ · {sample.reviewed ? 'ตรวจแล้ว' : 'รอตรวจ'} · {sample.split}</span>
        </button>)}
      </aside>
      <div className="min-w-0">{current ? <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} className={button} onClick={() => void detect()}>ช่วยตรวจจับด้วย YOLO</button>
          <button type="button" disabled={busy} className={`${button} border-blue-500 text-blue-700`} onClick={() => void save()}>บันทึก label</button>
          <button type="button" disabled={busy || !history.length} className={button} onClick={() => {
            setCurrent({ ...current, annotations: history[history.length - 1], reviewed: false }); setHistory(history.slice(0, -1)); setDirty(true);
          }}>ย้อนกลับ</button>
          <span className="text-xs text-slate-500">{current.width} × {current.height} px · ฉบับ {current.revision}{dirty ? ' · ยังไม่บันทึก' : ''}</span>
        </div>
        <AnnotationCanvas key={current.id} sample={current} dataset={dataset} disabled={busy} selectedId={selectedId} onSelect={setSelectedId} onChange={labels} />
      </> : <div className="rounded-2xl border bg-white p-12 text-center text-sm text-slate-500">เพิ่มหรือเลือกภาพเพื่อเริ่ม label</div>}</div>
      <aside className="space-y-4">{current && <>
        <fieldset disabled={busy} className="space-y-3 rounded-2xl border bg-white p-4">
          <label className="block text-xs text-slate-600">รอบถ่ายจริง (วัน/ช่วงเวลา)<input className={input} maxLength={100} value={current.session} placeholder="2026-11-01-morning" onChange={(e) => metadata({ session: e.target.value })} /></label>
          <label className="block text-xs text-slate-600">แบ่งชุดด้วยคน<select className={input} value={current.split} onChange={(e) => metadata({ split: e.target.value as AnnotationSample['split'] })}>
            <option value="unassigned">ยังไม่แบ่ง</option><option value="train">train</option><option value="val">val</option><option value="test">test</option>
          </select></label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-700"><input type="checkbox" checked={current.reviewed} onChange={(e) => { setCurrent({ ...current, reviewed: e.target.checked }); setDirty(true); }} />ตรวจภาพนี้ครบแล้ว รวมรถที่ YOLO พลาด จุดพื้น และสถานะถูกบัง (ภาพไม่มีรถต้องตรวจยืนยันด้วย)</label>
        </fieldset>
        <div className="max-h-48 overflow-y-auto rounded-2xl border bg-white p-2" aria-label="รายการกรอบรถ">{current.annotations.map((label, index) => <button type="button" key={label.id} disabled={busy} onClick={() => setSelectedId(label.id)} className={`block w-full rounded-lg p-2 text-left text-xs ${label.id === selectedId ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}>รถ {index + 1} · {label.occluded ? 'ถูกบัง' : 'เห็นชัด'} · {label.ground_point ? 'มีจุดพื้น' : 'ไม่ยืนยันจุดพื้น'}</button>)}</div>
        {selected ? <fieldset disabled={busy} className="space-y-3 rounded-2xl border bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">แก้กรอบที่เลือก (พิกเซล)</h2>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="ซ้าย X" value={selected.bbox.x * current.width} min={0} max={(1 - selected.bbox.width) * current.width} onCommit={(x) => changeBox({ ...selected.bbox, x: x / current.width })} />
            <NumberField label="บน Y" value={selected.bbox.y * current.height} min={0} max={(1 - selected.bbox.height) * current.height} onCommit={(y) => changeBox({ ...selected.bbox, y: y / current.height })} />
            <NumberField label="กว้าง" value={selected.bbox.width * current.width} min={1} max={(1 - selected.bbox.x) * current.width} onCommit={(w) => changeBox({ ...selected.bbox, width: w / current.width })} />
            <NumberField label="สูง" value={selected.bbox.height * current.height} min={1} max={(1 - selected.bbox.y) * current.height} onCommit={(h) => changeBox({ ...selected.bbox, height: h / current.height })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={selected.occluded} onChange={(e) => labels(current.annotations.map((label) => label.id === selected.id ? { ...label, occluded: e.target.checked } : label))} />รถถูกบังบางส่วน</label>
          <GroundPointFields key={`${selected.id}-${selected.ground_point?.x}-${selected.ground_point?.y}`} value={selected.ground_point ?? null} width={current.width} height={current.height} onChange={changePoint} />
          <button type="button" className="text-xs text-slate-600 underline" onClick={() => changePoint(null)}>ล้างจุดพื้น / มองไม่เห็นจึงไม่ยืนยัน</button>
          <button type="button" className={`${button} w-full text-rose-700`} onClick={() => { labels(current.annotations.filter((label) => label.id !== selected.id)); setSelectedId(null); }}>ลบกรอบรถนี้</button>
        </fieldset> : <p className="p-3 text-xs text-slate-500">เลือกกรอบจากรายการเพื่อแก้ค่า หรือใช้โหมด “วาดกรอบ” ลากบนภาพ</p>}
      </>}</aside>
    </div>}
  </form>;
}
