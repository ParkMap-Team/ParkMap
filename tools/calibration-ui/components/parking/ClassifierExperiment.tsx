"use client";

import { useEffect, useRef, useState } from 'react';
import type { components } from '@/types/api.gen';

type Model = components['schemas']['ClassifierModel'];
type Result = components['schemas']['ClassifierResult'];

export function ClassifierExperiment({ file }: { file: File | null }) {
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<'detect' | 'crop'>('detect');
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch('/api/classifier?op=models', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data && typeof data === 'object' && 'detail' in data ? String(data.detail) : 'โหลดโมเดลไม่ได้');
      if (!Array.isArray(data)) throw Error('รูปแบบรายการโมเดลไม่ถูกต้อง');
      const listed = data as Model[];
      if (!controller.signal.aborted) { setModels(listed); setModel(current => current || listed[0]?.id || ''); }
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason.message)); });
    return () => controller.abort();
  }, [enabled]);
  useEffect(() => () => request.current?.abort(), [file, model, mode, enabled]);
  const reset = () => { request.current?.abort(); setResult(null); setSelected(0); setBusy(false); setError(''); };
  const run = async () => {
    if (!file || !model || busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setResult(null); setError(''); setSelected(0);
    const body = new FormData(); body.set('image', file); body.set('model_id', model); body.set('mode', mode);
    try {
      const response = await fetch('/api/classifier?op=predict', { method: 'POST', body, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw Error(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : 'จำแนกรุ่นไม่ได้ กรุณาตรวจภาพและ API');
      if (!controller.signal.aborted) setResult(data as Result);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'จำแนกรุ่นไม่ได้'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const current = result?.crops[selected];
  const chosenModel = models.find(item => item.id === model);
  const imageFile = file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  return <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="จำแนกรุ่นรถทดลอง">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">จำแนกรุ่นรถ · ทดลอง</h2><label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => { reset(); setEnabled(event.target.checked); }} />เปิดใช้งาน</label></div>
    {enabled && <div className="mt-4 space-y-4">
      <p className="text-sm text-amber-800">ใช้ภาพที่เลือกด้านบน ผลนี้เป็นการทายตระกูลรถ ไม่ยืนยันรุ่นหรือขนาดจริง และไม่เปลี่ยนการคำนวณพื้นที่จอด ภาพไม่ถูกบันทึกเข้า dataset</p>
      <div className="flex flex-wrap items-end gap-3"><label className="text-sm">โมเดล<select className="mt-1 block max-w-full rounded border p-2" value={model} onChange={event => { reset(); setModel(event.target.value); }} aria-label="โมเดลจำแนกรุ่น"><option value="" disabled>เลือกโมเดลที่เทรนเสร็จแล้ว</option>{models.map((item, index) => <option key={item.id} value={item.id}>รอบที่ {index + 1} · {item.label} · best epoch {item.epoch}</option>)}</select></label>
      <label className="text-sm">รูปแบบภาพ<select className="mt-1 block rounded border p-2" value={mode} onChange={event => { reset(); setMode(event.target.value as 'detect' | 'crop'); }}><option value="detect">ภาพเต็ม · ให้ YOLO หารถ</option><option value="crop">ภาพ crop รถคันเดียว · ไม่ใช้ YOLO</option></select></label>
      <button type="button" className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!imageFile || !model || busy} onClick={() => void run()}>{busy ? 'กำลังจำแนกรุ่น…' : 'ทดสอบจำแนกรุ่น'}</button></div>
      {!imageFile && <p className="text-sm text-slate-600">เลือกภาพ JPEG, PNG หรือ WebP ด้านบนก่อน ส่วนนี้ทดสอบภาพนิ่ง ไม่วิเคราะห์วิดีโออัตโนมัติ</p>}
      {chosenModel && <p className="text-xs text-slate-500">Validation ของโมเดลนี้: {(chosenModel.val_top1 * 100).toFixed(1)}% · แต่ละรอบอาจใช้ validation คนละชุด จึงไม่ใช่การเทียบคะแนนบนรูปเดียวกัน</p>}
      {!models.length && !error && <p role="status" className="text-sm">ยังไม่มีโมเดลที่โหลดได้ หรือกำลังโหลดรายการ</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && <><p role="status" className="text-sm">พบ {result.crops.length} คัน · กดกรอบหรือภาพย่อเพื่อดูคำตอบ</p><div className="grid gap-5 lg:grid-cols-2">
        <div><div className="relative overflow-hidden rounded bg-slate-100"><img src={result.preview_url} alt="ภาพทดสอบที่ปรับทิศทางแล้ว" className="block w-full" /><svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="กรอบรถที่ตรวจพบ">{result.crops.map((crop, index) => <rect key={index} x={crop.bbox.x} y={crop.bbox.y} width={crop.bbox.width} height={crop.bbox.height} fill={selected === index ? 'rgba(37,99,235,.15)' : 'transparent'} stroke={selected === index ? '#2563eb' : '#d97706'} strokeWidth=".004" className="cursor-pointer" onClick={() => setSelected(index)}><title>คันที่ {index + 1}</title></rect>)}</svg></div>
        <div className="mt-2 flex flex-wrap gap-2">{result.crops.map((crop, index) => <button type="button" key={index} aria-pressed={selected === index} aria-label={`ดูรถคันที่ ${index + 1}`} onClick={() => setSelected(index)} className={`rounded border p-1 ${selected === index ? 'border-blue-700' : 'border-slate-200'}`}><img src={crop.crop_url} alt={`รถคันที่ ${index + 1}`} className="h-16 w-20 object-contain" /></button>)}</div></div>
        {current && <div><h3 className="font-semibold">คันที่ {selected + 1} · ผลอันดับ 1–3</h3><img src={current.crop_url} alt="Crop ที่ส่งเข้า classifier" className="my-3 h-52 w-full rounded bg-slate-100 object-contain" /><ol className="space-y-3">{current.top3.map((prediction, index) => <li key={prediction.family} className="flex justify-between gap-3 border-b pb-2"><span>{index + 1}. {prediction.family}</span><span>{(prediction.score * 100).toFixed(1)}%</span></li>)}</ol><p className="mt-3 text-xs text-slate-500">คะแนน softmax ยังไม่ได้ปรับเทียบเป็นความมั่นใจ และโมเดลไม่มีคลาส unknown แม้รถอยู่นอกชุดรุ่นก็อาจได้คะแนนสูง</p></div>}
      </div>{!result.crops.length && <p className="text-sm text-amber-800">YOLO ไม่พบรถ ไม่ได้หมายความว่าภาพไม่มีรถ ลอง crop รถคันเดียวแล้วเลือกโหมดภาพ crop</p>}</>}
    </div>}
  </section>;
}
