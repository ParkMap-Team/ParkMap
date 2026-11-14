'use client';

import { useState } from 'react';
import { LotModelEditor } from '../lot-model/LotModelEditor';
import { SetupPage } from './SetupPage';
import { MobileCameraSetup } from './MobileCameraSetup';

export function SetupWorkspace({ initialTab = 'camera' }: { initialTab?: 'camera' | 'lot' | 'mobile' }) {
  const [tab, setTab] = useState(initialTab);
  const [visited, setVisited] = useState(() => new Set([initialTab]));
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-semibold">Setup สถานที่</h1><p className="mt-2 text-sm text-slate-500">ตั้งค่าแผนผังและกล้องในที่เดียว ปุ่มบันทึกของแต่ละงานแยกกัน ตรวจให้กล้องและสถานที่ที่เลือกตรงกัน</p></div>
    <div className="inline-flex flex-wrap gap-1 rounded-xl border bg-white p-1" role="tablist" aria-label="ตั้งค่าสถานที่">
      {([['camera', 'กล้องและ Calibration'], ['lot', 'แผนผังสถานที่'], ['mobile', 'กล้องมือถือ / QR']] as const).map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={tab === id}
        className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        onClick={() => { setTab(id); setVisited((old) => new Set([...old, id])); }}>{name}</button>)}
    </div>
    <p className="text-xs text-slate-500">ROI บนภาพกล้องใช้กำหนดขอบเขตวิเคราะห์ ส่วน ROI บนแผนผังใช้จัดวางพื้นที่ในหน่วยเมตร</p>
    {visited.has('camera') && <div hidden={tab !== 'camera'}><SetupPage /></div>}
    {visited.has('lot') && <div hidden={tab !== 'lot'}><LotModelEditor /></div>}
    {visited.has('mobile') && <div hidden={tab !== 'mobile'}><MobileCameraSetup /></div>}
  </section>;
}
