'use client';

import { useState } from 'react';
import { editableVertices, moveLandmark, moveVertex, rectangleDimensions, resizeRectangle, rotatePolygonObject, scalePolygonObject } from '../../lib/lotModelEditor';
import type { LotLandmark } from '../../types/lotModel';
import { NumberField } from './LandmarkProperties';

export function RoiProperties({ object, disabled, onChange, onUseAsOutline }: {
  object: LotLandmark; disabled: boolean; onChange: (object: LotLandmark) => void; onUseAsOutline?: () => void;
}) {
  const rectangle = rectangleDimensions(object);
  const [scalePercent, setScalePercent] = useState('100');
  const percent = Number(scalePercent);
  const canScale = scalePercent.trim() !== '' && Number.isFinite(percent) && percent >= 1 && percent <= 1000;
  const ring = object.polygon![0];
  const angle = Math.atan2(ring[1].y_m - ring[0].y_m, ring[1].x_m - ring[0].x_m) * 180 / Math.PI;
  return <section className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
    <h2 className="font-semibold text-blue-900">พื้นที่ ROI</h2>
    <p className="mt-1 break-all text-xs text-slate-500">{object.name}</p>
    <fieldset disabled={disabled} className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="กึ่งกลาง X (เมตร)" value={object.position.x_m} onCommit={(x_m) => onChange(moveLandmark(object, { ...object.position, x_m }))} />
        <NumberField label="กึ่งกลาง Y (เมตร)" value={object.position.y_m} onCommit={(y_m) => onChange(moveLandmark(object, { ...object.position, y_m }))} />
      </div>
      <NumberField label="มุมด้านแรกจากแกน X (องศา)" value={angle} onCommit={(degrees) => onChange(rotatePolygonObject(object, degrees - angle))} />
      <div className="flex gap-2">{[-15, 15, 90].map((degrees) => <button type="button" key={degrees}
        className="rounded-lg border border-blue-200 px-3 py-2 text-xs text-blue-700 disabled:opacity-40"
        onClick={() => onChange(rotatePolygonObject(object, degrees))}>{degrees > 0 ? '+' : ''}{degrees}°</button>)}</div>
      <p className="text-xs leading-relaxed text-slate-500">หมุนรอบกึ่งกลางกรอบครอบรูป ค่าบวกหมุนทวนเข็มนาฬิกา โดยคงรูปทรงและช่องว่างด้านใน</p>
      <div className="space-y-3 rounded-xl bg-blue-50 p-3">
        <p className="text-sm font-medium text-blue-900">ย่อ–ขยายการแสดงผลแบบคงรูป</p>
        <div className="flex gap-2">{[90, 110].map(value => <button type="button" key={value}
          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-blue-700"
          onClick={() => onChange(scalePolygonObject(object, value/100))}>{value === 90 ? 'ย่อ 10%' : 'ขยาย 10%'}</button>)}</div>
        <label className="block text-xs text-slate-600">ปรับเป็น % ของขนาดปัจจุบัน
          <input type="number" min={1} max={1000} step="any" value={scalePercent} onChange={event => setScalePercent(event.target.value)}
            className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
        </label>
        <button type="button" disabled={!canScale} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-40"
          onClick={() => { if (canScale) { onChange(scalePolygonObject(object, percent/100)); setScalePercent('100'); } }}>ใช้ขนาดนี้</button>
        <p className="text-xs leading-relaxed text-slate-500">100% เท่าขนาดปัจจุบัน · คงสัดส่วน จุดกึ่งกลาง องศา และช่องว่างด้านใน รถและแถวขยายตามบนแผนผังเท่านั้น ไม่เปลี่ยนระยะเมตรที่ใช้หาพื้นที่</p>
      </div>
      {onUseAsOutline && <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700" onClick={onUseAsOutline}>ใช้ ROI นี้เป็นขอบลาน</button>
        <p className="text-xs leading-relaxed text-slate-500">หากย้ายหรือหมุนจน ROI เลยกรอบสีเทา ให้กดปุ่มนี้ก่อนบันทึก ขอบลานจะเปลี่ยนให้ตรงกับ ROI นี้ และพื้นที่นอก ROI จะไม่รวมในลาน</p>
      </div>}
      {rectangle && <div className="grid grid-cols-2 gap-3">
        <NumberField label="กว้าง (เมตร)" value={rectangle.width} min={0.01} onCommit={(width) => onChange(resizeRectangle(object, width, rectangle.length, rectangle.rotation))} />
        <NumberField label="ยาว (เมตร)" value={rectangle.length} min={0.01} onCommit={(length) => onChange(resizeRectangle(object, rectangle.width, length, rectangle.rotation))} />
      </div>}
      <details><summary className="cursor-pointer text-xs font-medium text-slate-600">พิกัดจุดมุม (เมตร)</summary>
        {object.polygon!.map((points, ringIndex) => <div key={ringIndex} className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">{ringIndex ? `ช่องว่าง ${ringIndex}` : 'ขอบนอก'}</p>
          {editableVertices(points).map((point, index) => <div key={index} className="grid grid-cols-2 gap-2">
            <NumberField label={`${index + 1} · X`} value={point.x_m} onCommit={(x_m) => onChange(moveVertex(object, ringIndex, index, { ...point, x_m }))} />
            <NumberField label={`${index + 1} · Y`} value={point.y_m} onCommit={(y_m) => onChange(moveVertex(object, ringIndex, index, { ...point, y_m }))} />
          </div>)}
        </div>)}
      </details>
    </fieldset>
    <p className="mt-4 text-xs leading-relaxed text-amber-800">ย้าย หมุน หรือย่อ–ขยายเท่ากันทั้งรูป: รถและพื้นที่ผลวิเคราะห์จะตามเมื่อเปิดใช้ โดยคงระยะวิเคราะห์เดิม หากขยับจุดมุมจนรูปทรงเปลี่ยนหรือยืดไม่เท่ากัน ต้องตรวจ calibration ใหม่</p>
  </section>;
}
