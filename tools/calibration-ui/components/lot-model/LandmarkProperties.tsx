'use client';

import { useState } from 'react';
import { editableVertices, insertVertex, LANDMARK_NAMES, moveLandmark, moveVertex, rectangleDimensions, removeVertex, resizeRectangle } from '../../lib/lotModelEditor';
import type { LotLandmark } from '../../types/lotModel';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';
const numericText = (value: number) => String(Number(value.toFixed(4)));

export function NumberField({ label, value, min, max, onCommit }: {
  label: string; value: number; min?: number; max?: number; onCommit: (value: number) => void;
}) {
  return <NumericInput key={value} label={label} value={value} min={min} max={max} onCommit={onCommit} />;
}

function NumericInput({ label, value, min, max, onCommit }: {
  label: string; value: number; min?: number; max?: number; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(() => numericText(value));
  const [error, setError] = useState('');
  const [edited, setEdited] = useState(false);
  return <label className="block text-xs font-medium text-slate-600">{label}
    <input type="number" step="any" required min={min} max={max} value={text} className={inputClass} aria-invalid={!!error}
      onChange={(event) => { event.currentTarget.setCustomValidity(''); setError(''); setEdited(true); setText(event.target.value); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
      onBlur={(event) => {
        const number = Number(text);
        if (!text.trim() || !Number.isFinite(number) || (min !== undefined && number < min) || (max !== undefined && number > max)) {
          const message = 'ค่าตัวเลขไม่ถูกต้อง ยังไม่ใช้ค่านี้';
          setError(message); event.currentTarget.setCustomValidity(message); return;
        }
        event.currentTarget.setCustomValidity(''); setError('');
        // Focusing a rounded display must not round original coordinates; an explicit edit may.
        if (edited && number !== value) {
          try { onCommit(number); } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'ไม่สามารถปรับค่านี้ได้';
            setError(message); event.currentTarget.setCustomValidity(message);
          }
        }
        setEdited(false);
      }} />
    {error && <span className="mt-1 block text-xs text-rose-700">{error}</span>}
  </label>;
}

export function LandmarkProperties({ landmark, disabled, onChange }: {
  landmark: LotLandmark; disabled: boolean; onChange: (landmark: LotLandmark) => void;
}) {
  const rectangle = rectangleDimensions(landmark);
  const raised = !!landmark.polygon && ['BUILDING', 'GUARD_BOOTH', 'PLANTING', 'SHELTER', 'BARRIER'].includes(landmark.kind);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="font-semibold text-slate-900">{LANDMARK_NAMES[landmark.kind]}</h2>
    <p className="mt-1 break-all text-xs text-slate-400">{landmark.landmark_id}</p>
    <fieldset disabled={disabled} className="mt-4 space-y-4">
      <label className="block text-xs font-medium text-slate-600">ชื่อที่แสดง
        <input type="text" maxLength={40} value={landmark.name ?? ''} className={inputClass} placeholder={LANDMARK_NAMES[landmark.kind]}
          onChange={(event) => onChange({ ...landmark, name: event.target.value || null })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="ตำแหน่ง X (เมตร)" value={landmark.position.x_m} onCommit={(x_m) => onChange(moveLandmark(landmark, { ...landmark.position, x_m }))} />
        <NumberField label="ตำแหน่ง Y (เมตร)" value={landmark.position.y_m} onCommit={(y_m) => onChange(moveLandmark(landmark, { ...landmark.position, y_m }))} />
      </div>
      {rectangle && <>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="กว้าง (เมตร)" value={rectangle.width} min={0.01} onCommit={(width) => onChange(resizeRectangle(landmark, width, rectangle.length, rectangle.rotation))} />
          <NumberField label="ยาว (เมตร)" value={rectangle.length} min={0.01} onCommit={(length) => onChange(resizeRectangle(landmark, rectangle.width, length, rectangle.rotation))} />
        </div>
        <NumberField label="มุมหมุนจากแกน X (องศา)" value={rectangle.rotation} onCommit={(angle) => onChange(resizeRectangle(landmark, rectangle.width, rectangle.length, angle))} />
        <p className="text-xs leading-relaxed text-slate-400">ด้านกว้างคือด้านแรกของรูป การปรับขนาดจะคงจุดกึ่งกลางเดิม</p>
      </>}
      {landmark.kind === 'TREE' && <>
        <NumberField label="รัศมีพุ่ม (เมตร)" value={landmark.radius_m!} min={0.01} max={Math.min(30, landmark.height_m!)} onCommit={(radius_m) => onChange({ ...landmark, radius_m })} />
        <p className="text-xs text-slate-400">พุ่มกว้างประมาณ {numericText(landmark.radius_m! * 2)} เมตรในโมเดล</p>
      </>}
      {(raised || landmark.kind === 'TREE') && <NumberField label={landmark.kind === 'SHELTER' ? 'ความสูงหลังคา (เมตร)' : 'ความสูง (เมตร)'}
        value={landmark.height_m ?? 0} min={landmark.kind === 'TREE' ? landmark.radius_m! : landmark.kind === 'SHELTER' ? 0.01 : 0} max={300}
        onCommit={(value) => {
          const next = { ...landmark, height_m: value || null };
          if (!value) delete next.facade;
          onChange(next);
        }} />}
      {landmark.kind === 'BUILDING' && !!landmark.height_m && <label className="block text-xs font-medium text-slate-600">ผิวอาคาร
        <select className={inputClass} value={landmark.facade ?? ''} onChange={(event) => onChange({ ...landmark, facade: (event.target.value || null) as LotLandmark['facade'] })}>
          <option value="">เรียบ</option><option value="WINDOW_BANDS">แนวหน้าต่าง</option><option value="BRICK_AND_GLASS">อิฐและกระจก</option>
        </select>
      </label>}
      {(landmark.kind === 'ENTRANCE' || landmark.kind === 'EXIT') && <div className="space-y-3">
        <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" className="mt-0.5" checked={landmark.direction_rad != null}
          onChange={(event) => onChange({ ...landmark, direction_rad: event.target.checked ? 0 : null })} />ยืนยันทิศทางสัญจรแล้ว</label>
        {landmark.direction_rad != null && <NumberField label="ทิศทางจากแกน X (องศา)" value={landmark.direction_rad * 180 / Math.PI}
          onCommit={(angle) => onChange({ ...landmark, direction_rad: angle * Math.PI / 180 })} />}
      </div>}
      <label className="block text-xs font-medium text-slate-600">แหล่งข้อมูล
        <select className={inputClass} value={landmark.measurement_source ?? 'ESTIMATED'} onChange={(event) => onChange({ ...landmark, measurement_source: event.target.value as LotLandmark['measurement_source'] })}>
          <option value="ESTIMATED">ประมาณจากภาพ / แผนที่</option><option value="MEASURED">วัดจากสถานที่จริงแล้ว</option>
        </select>
      </label>
      {landmark.polygon && <details open={!rectangle} className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">จุดมุม ({landmark.polygon.reduce((count, ring) => count + ring.length, 0)} จุด)</summary>
        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
          {landmark.polygon.map((ring, ringIndex) => {
            const points = editableVertices(ring);
            return <div key={ringIndex}>
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400"><span>{ringIndex ? `ช่องว่างภายใน ${ringIndex}` : 'ขอบนอก'}</span>
              <button type="button" className="rounded border border-slate-200 px-2 py-1 text-blue-600 hover:bg-blue-50" onClick={() => onChange(insertVertex(landmark, ringIndex, points.length - 1))}>+ จุดมุม</button></div>
            {points.map((point, vertexIndex) => <div key={vertexIndex} className="mb-2 grid grid-cols-2 gap-2">
              <NumberField label={`จุด ${vertexIndex + 1} · X`} value={point.x_m} onCommit={(x_m) => onChange(moveVertex(landmark, ringIndex, vertexIndex, { ...point, x_m }))} />
              <NumberField label={`จุด ${vertexIndex + 1} · Y`} value={point.y_m} onCommit={(y_m) => onChange(moveVertex(landmark, ringIndex, vertexIndex, { ...point, y_m }))} />
              <button type="button" className="col-span-2 justify-self-end text-[10px] text-rose-600 disabled:opacity-30" disabled={points.length <= 3}
                onClick={() => onChange(removeVertex(landmark, ringIndex, vertexIndex))}>ลบจุด {vertexIndex + 1}</button>
            </div>)}
          </div>;
          })}
        </div>
      </details>}
      {landmark.line && <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs text-slate-600">จุดแนวกั้น</summary>
        <div className="mt-3 space-y-3">{landmark.line.map((point, index) => <div key={index} className="grid grid-cols-2 gap-2">
          <NumberField label={`จุด ${index + 1} · X`} value={point.x_m} onCommit={(x_m) => onChange({ ...landmark, line: landmark.line!.map((p, i) => i === index ? { ...p, x_m } : p) })} />
          <NumberField label={`จุด ${index + 1} · Y`} value={point.y_m} onCommit={(y_m) => onChange({ ...landmark, line: landmark.line!.map((p, i) => i === index ? { ...p, y_m } : p) })} />
        </div>)}</div>
      </details>}
    </fieldset>
  </section>;
}
