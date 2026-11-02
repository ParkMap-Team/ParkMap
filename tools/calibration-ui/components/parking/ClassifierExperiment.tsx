"use client";

import { useEffect, useState } from 'react';
import type { components } from '@/types/api.gen';

type Model = components['schemas']['ClassifierModel'];
type Result = components['schemas']['ClassifierResult'];

export function ClassifierExperiment({ model, onModelChange, result, error, busy }: {
  model: string; onModelChange: (model: string) => void; result: Result | null; error: string; busy: boolean;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/classifier?op=models', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw Error('Unable to load classifier models.');
      const listed = data as Model[];
      if (!controller.signal.aborted) {
        setModels(listed);
        onModelChange(listed.at(-1)?.id ?? '');
      }
    }).catch(reason => { if (!controller.signal.aborted) setLoadError(String(reason.message)); });
    return () => controller.abort();
  }, [onModelChange]);
  const selectedIndex = result && selected < result.crops.length ? selected : 0;
  const current = result?.crops[selectedIndex];
  const chosenModel = models.find(item => item.id === model);
  return <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="จำแนกรุ่นรถทดลอง">
    <h2 className="font-semibold">จำแนกรุ่นรถ · ทดลอง</h2>
    <p className="mt-2 text-sm text-slate-600">เลือกโมเดล แล้วกด Analyze ด้านบนเพื่อตรวจจับและจำแนกรุ่นพร้อมกัน</p>
    {<div className="mt-4 space-y-4">
      <p className="text-sm text-amber-800">ผลนี้เป็นการทายตระกูลรถ ไม่ยืนยันรุ่นหรือขนาดจริง ขนาดตามคลาสเป็นค่าอ้างอิงที่ใช้ในผลทดลองเท่านั้น ภาพไม่ถูกบันทึกเข้า dataset</p>
      <div className="flex flex-wrap items-end gap-3"><label className="text-sm">โมเดล<select className="mt-1 block max-w-full rounded border p-2" value={model} disabled={busy} onChange={event => { setSelected(0); onModelChange(event.target.value); }} aria-label="โมเดลจำแนกรุ่น"><option value="" disabled>เลือกโมเดลที่เทรนเสร็จแล้ว</option>{models.map((item, index) => <option key={item.id} value={item.id}>รอบที่ {index + 1} · {item.label} · best epoch {item.epoch}</option>)}</select></label>
      </div>
      {busy && <p role="status" className="text-sm">กำลังตรวจจับและจำแนกรุ่น…</p>}
      {chosenModel && <p className="text-xs text-slate-500">Validation ของโมเดลนี้: {(chosenModel.val_top1 * 100).toFixed(1)}% · แต่ละรอบอาจใช้ validation คนละชุด จึงไม่ใช่การเทียบคะแนนบนรูปเดียวกัน</p>}
      {!models.length && !error && <p role="status" className="text-sm">ยังไม่มีโมเดลที่โหลดได้ หรือกำลังโหลดรายการ</p>}
      {(error || loadError) && <p role="alert" className="text-sm text-red-700">{error || loadError}</p>}
      {current?.reference_size && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900" aria-label="ขนาดอ้างอิงของรถ">ขนาดอ้างอิง (ทดลอง): กว้าง {current.reference_size.width_m.toFixed(2)} ม. × ยาว {current.reference_size.length_m.toFixed(2)} ม. · {current.reference_size.reason === 'CLASS_RULE' ? `ตามคลาส ${current.reference_size.rule_class}` : `ใช้ค่า fallback (${current.reference_size.reason})`} · {current.reference_size.basis}</p>}
      {result && <><p role="status" className="text-sm">พบ {result.crops.length} คัน · กดกรอบหรือภาพย่อเพื่อดูคำตอบ</p><div className="grid gap-5 lg:grid-cols-2">
        <div><div className="relative overflow-hidden rounded bg-slate-100"><img src={result.preview_url} alt="ภาพทดสอบที่ปรับทิศทางแล้ว" className="block w-full" /><svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="กรอบรถที่ตรวจพบ">{result.crops.map((crop, index) => <rect key={index} x={crop.bbox.x} y={crop.bbox.y} width={crop.bbox.width} height={crop.bbox.height} fill={selectedIndex === index ? 'rgba(37,99,235,.15)' : 'transparent'} stroke={selectedIndex === index ? '#2563eb' : '#d97706'} strokeWidth=".004" className="cursor-pointer" onClick={() => setSelected(index)}><title>คันที่ {index + 1}</title></rect>)}</svg></div>
        <div className="mt-2 flex flex-wrap gap-2">{result.crops.map((crop, index) => <button type="button" key={index} aria-pressed={selectedIndex === index} aria-label={`ดูรถคันที่ ${index + 1}`} onClick={() => setSelected(index)} className={`rounded border p-1 ${selectedIndex === index ? 'border-blue-700' : 'border-slate-200'}`}><img src={crop.crop_url} alt={`รถคันที่ ${index + 1}`} className="h-16 w-20 object-contain" /></button>)}</div></div>
        {current && <div><h3 className="font-semibold">คันที่ {selectedIndex + 1} · ผลอันดับ 1–3</h3><img src={current.crop_url} alt="Crop ที่ส่งเข้า classifier" className="my-3 h-52 w-full rounded bg-slate-100 object-contain" /><ol className="space-y-3">{current.top3.map((prediction, index) => <li key={prediction.family} className="flex justify-between gap-3 border-b pb-2"><span>{index + 1}. {prediction.family}</span><span>{(prediction.score * 100).toFixed(1)}%</span></li>)}</ol><p className="mt-3 text-xs text-slate-500">คะแนน softmax ยังไม่ได้ปรับเทียบเป็นความมั่นใจ และโมเดลไม่มีคลาส unknown แม้รถอยู่นอกชุดรุ่นก็อาจได้คะแนนสูง</p></div>}
      </div>{!result.crops.length && <p className="text-sm text-amber-800">YOLO ไม่พบรถ จึงยังไม่มี crop สำหรับจำแนกรุ่น ไม่ได้หมายความว่าภาพไม่มีรถ</p>}</>}
    </div>}
  </section>;
}
