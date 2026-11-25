'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Redo2, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import { insertRoutePoint, moveRoutePoint, removeRoutePoint, routeEditorRequest, ROUTE_COLORS, ROUTE_ROWS,
  type RouteConfiguration, type RouteEditorState, type RoutePlan, type RoutePreview } from '../../lib/routeEditor';
import { RouteCanvas } from './RouteCanvas';
import { twMerge as cn } from 'tailwind-merge';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40';
type History = { past: RouteConfiguration[]; current: RouteConfiguration; future: RouteConfiguration[] };

function Coordinate({ label, value, disabled, onChange, onValidity }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void; onValidity: (valid: boolean) => void }) {
  const [text, setText] = useState(String(value));
  const [previous, setPrevious] = useState(value);
  if (previous !== value) { setPrevious(value); setText(String(value)); }
  return <label className="text-sm font-medium">{label} (ม.)<input type="number" min={-1000} max={1000} step="any" required value={text} disabled={disabled}
    className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 py-2 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    onBlur={() => { if (text === '' || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1000) { setText(String(value)); onValidity(true); } }}
    onChange={event => { setText(event.target.value); const valid = event.target.value !== '' && event.target.validity.valid;
      onValidity(valid); if (valid) onChange(event.target.valueAsNumber); }} /></label>;
}

export function RouteEditor() {
  const [state, setState] = useState<RouteEditorState | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [row, setRow] = useState('row_1');
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invalidCoordinates, setInvalidCoordinates] = useState({ x: false, y: false });
  const invalid = invalidCoordinates.x || invalidCoordinates.y;
  const [preview, setPreview] = useState<{ configuration: RouteConfiguration; routes: RoutePreview[] } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const sequence = useRef(0);
  const current = history?.current;
  const dirty = !!state && !!current && JSON.stringify(state.configuration) !== JSON.stringify(current);
  const pending = !!current && preview?.configuration !== current;
  const plan = current?.rows[row];
  const index = plan ? Math.min(selected, plan.waypoints.length - 1) : 0;
  const point = plan?.waypoints[index];

  function accept(result: RouteEditorState) {
    setState(result); setHistory({ past: [], current: result.configuration, future: [] });
    setPreview({ configuration: result.configuration, routes: result.previews }); setPreviewError(''); setSelected(0); setAdding(false); setInvalidCoordinates({ x: false, y: false });
  }
  async function load(signal?: AbortSignal) {
    try {
      const result = await routeEditorRequest<RouteEditorState>('routes', 'GET', undefined, signal);
      if (signal?.aborted) return;
      accept(result);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'โหลดเส้นทางไม่สำเร็จ'); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void routeEditorRequest<RouteEditorState>('routes', 'GET', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) accept(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลดเส้นทางไม่สำเร็จ'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController(); const request = ++sequence.current;
    const timer = setTimeout(() => {
      setPreviewError('');
      void routeEditorRequest<RoutePreview[]>('route-preview', 'POST', current, controller.signal).then(routes => {
        if (!controller.signal.aborted && request === sequence.current) setPreview({ configuration: current, routes });
      }).catch(cause => { if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : 'แสดงเส้นตัวอย่างไม่สำเร็จ'); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [current]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function change(next: RoutePlan, record = true) {
    setHistory(old => old ? { past: record ? [...old.past, old.current].slice(-50) : old.past,
      current: { ...old.current, rows: { ...old.current.rows, [row]: next } }, future: record ? [] : old.future } : old);
    setNotice(''); setError('');
  }
  function finishDrag(before: RoutePlan) {
    setHistory(old => old ? { ...old, past: [...old.past, { ...old.current, rows: { ...old.current.rows, [row]: before } }].slice(-50), future: [] } : old);
  }
  function undo() {
    setHistory(old => old?.past.length ? { past: old.past.slice(0, -1), current: old.past.at(-1)!, future: [old.current, ...old.future] } : old);
    setSelected(0); setInvalidCoordinates({ x: false, y: false }); setAdding(false); setNotice('');
  }
  function redo() {
    setHistory(old => old?.future.length ? { past: [...old.past, old.current], current: old.future[0], future: old.future.slice(1) } : old);
    setSelected(0); setInvalidCoordinates({ x: false, y: false }); setAdding(false); setNotice('');
  }
  async function save() {
    if (!state || !current || busy || pending || previewError || invalid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await routeEditorRequest<RouteEditorState>('routes', 'PUT', { configuration: current, expected_revision: state.revision,
        expected_lot_version: state.lot_model.version });
      setState(result); setHistory({ past: [], current: result.configuration, future: [] }); setPreview({ configuration: result.configuration, routes: result.previews });
      setNotice('บันทึกแล้ว คำแนะนำใหม่ใน LIFF จะใช้เส้นทางนี้ ส่วนคำแนะนำที่ถือจุดอยู่แล้วคงเส้นเดิม');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'บันทึกเส้นทางไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  const label = ROUTE_ROWS.find(([id]) => id === row)?.[1];
  return <section className="space-y-4" aria-label="เครื่องมือแก้เส้นทาง LIFF">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">เส้นทางแนะนำใน LIFF</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">เลือกแถวแล้วลาก เพิ่ม หรือลบจุดเลี้ยว ตรวจตัวอย่างก่อนบันทึก การแก้เส้นทางไม่เปลี่ยนพื้นที่ว่างหรือจุดจอดที่ถูกถือไว้</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => { if (!dirty || window.confirm('โหลดข้อมูลล่าสุดและทิ้งส่วนที่ยังไม่บันทึกหรือไม่?')) { setBusy(true); setError(''); void load(); } }}>โหลดล่าสุด</button>
        <button type="button" className={cn(button, 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700')} disabled={busy || !dirty || pending || !!previewError || invalid} onClick={() => void save()}><Save size={16} />{busy ? 'กำลังดำเนินการ…' : 'บันทึกใช้ใน LIFF'}</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
    {!state || !current || !plan || !point ? <p role="status" className="p-6 text-sm text-slate-600">{busy ? 'กำลังโหลดแผนผังและเส้นทาง…' : 'เปิด API และ Calibration UI ผ่าน start-dev.bat แล้วกดโหลดล่าสุด'}</p> : <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="เลือกแถวแก้เส้นทาง">
        {ROUTE_ROWS.map(([id, name]) => <button key={id} type="button" className={cn(button, row === id && 'border-blue-600 bg-blue-50 text-blue-800')} aria-pressed={row === id} disabled={busy}
          onClick={() => { setRow(id); setSelected(0); setAdding(false); setInvalidCoordinates({ x: false, y: false }); }}><span className="size-3 rounded-full" style={{ background: ROUTE_COLORS[id] }} />แถว {name}</button>)}
        <span className="ml-auto text-sm text-slate-500">{dirty ? 'ยังไม่บันทึก' : 'ตรงกับค่าที่บันทึก'}</span>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <RouteCanvas state={state} previews={preview?.routes ?? []} row={row} plan={plan} selected={index} disabled={busy} adding={adding} pending={pending}
          onSelect={setSelected} onPreview={next => change(next, false)} onCommit={change} onDragEnd={finishDrag}
          onAdd={p => { change(insertRoutePoint(plan, index, p)); setSelected(index + 1); setAdding(false); }} />
        <aside className="space-y-4 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">จุดเลี้ยวแถว {label}</h3><span className="text-xs tabular-nums text-slate-500">{plan.waypoints.length}/32 จุด</span></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy || !history?.past.length} onClick={undo} aria-label="ย้อนกลับ"><Undo2 size={16} /></button>
            <button type="button" className={button} disabled={busy || !history?.future.length} onClick={redo} aria-label="ทำซ้ำ"><Redo2 size={16} /></button>
            <button type="button" className={cn(button, adding && 'border-blue-600 bg-blue-50')} disabled={busy || plan.waypoints.length >= 32} aria-pressed={adding} onClick={() => setAdding(!adding)}><Plus size={16} />{adding ? 'ยกเลิกเพิ่มจุด' : 'เพิ่มบนแผนที่'}</button>
          </div>
          <ol className="max-h-64 space-y-1 overflow-y-auto" aria-label="ลำดับจุดเลี้ยว">
            {plan.waypoints.map((p, i) => <li key={i}><button type="button" className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm focus-visible:ring-2 ${i === index ? 'bg-blue-50 text-blue-900 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
              onClick={() => { setSelected(i); setInvalidCoordinates({ x: false, y: false }); }} disabled={busy}><span>จุด {i + 1}</span><span className="font-mono text-xs">{p.x_m.toFixed(2)}, {p.y_m.toFixed(2)}</span></button></li>)}
          </ol>
          <div className="grid grid-cols-2 gap-3" key={`${row}:${index}`}>
            <Coordinate label="X" value={point.x_m} disabled={busy} onValidity={valid => setInvalidCoordinates(old => ({ ...old, x: !valid }))} onChange={x => change(moveRoutePoint(plan, index, { ...point, x_m: x }))} />
            <Coordinate label="Y" value={point.y_m} disabled={busy} onValidity={valid => setInvalidCoordinates(old => ({ ...old, y: !valid }))} onChange={y => change(moveRoutePoint(plan, index, { ...point, y_m: y }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy || plan.waypoints.length >= 32} onClick={() => { change(insertRoutePoint(plan, index)); setSelected(index + 1); }}><Plus size={16} />แทรกต่อจากจุดนี้</button>
            <button type="button" className={button} disabled={busy || plan.waypoints.length <= 1} onClick={() => { change(removeRoutePoint(plan, index)); setSelected(Math.max(0, index - 1)); setInvalidCoordinates({ x: false, y: false }); }}><Trash2 size={16} />ลบจุด</button>
            {[-1, 1].map(delta => <button key={delta} type="button" className={button} disabled={busy || index + delta < 0 || index + delta >= plan.waypoints.length} aria-label={delta < 0 ? 'เลื่อนจุดขึ้น' : 'เลื่อนจุดลง'} onClick={() => {
              const next = [...plan.waypoints]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change({ ...plan, waypoints: next }); setSelected(index + delta);
            }}>{delta < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}
          </div>
          <label className="block text-sm font-medium">การเชื่อมจากจุดสุดท้ายเข้าจุดจอด<select value={plan.entry} disabled={busy} onChange={event => change({ ...plan, entry: event.target.value as RoutePlan['entry'] })}
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 focus-visible:ring-2">
            <option value="vertical">เลี้ยวเข้าตามแนวตั้งบนแผนที่</option><option value="horizontal">เลี้ยวเข้าตามแนวนอนบนแผนที่</option><option value="direct">ตรงเข้าจุดหมาย</option>
          </select></label>
          <button type="button" className={button} disabled={busy} onClick={() => { change(state.defaults.rows[row]); setSelected(0); setInvalidCoordinates({ x: false, y: false }); }}><RotateCcw size={16} />ค่าเริ่มต้นแถวนี้</button>
          <p role="status" className={`text-xs ${previewError ? 'text-red-700' : 'text-slate-500'}`}>{previewError || (pending ? 'กำลังปรับเส้นตัวอย่าง…' : 'ตัวอย่างไปจุดกลางแถว ไม่ใช่การยืนยันว่าจอดได้')}</p>
        </aside>
      </div>
    </>}
  </section>;
}
