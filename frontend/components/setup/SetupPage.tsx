'use client';

import { useState } from 'react';
import { GroundMapSetup } from './GroundMapSetup';
import { ParkingAreaSetup } from './ParkingAreaSetup';
import { PhysicalDimensionsSetup } from './PhysicalDimensionsSetup';

export function SetupPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [rowRevision, setRowRevision] = useState(0);
  const [mode, setMode] = useState<'parking' | 'ground'>('parking');

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold">Setup</h1>
      <p className="mt-1 text-sm text-slate-500">ใช้รูปอ้างอิงรูปเดียว แล้วตั้งค่า 2 ขั้นตอนหลัก</p>
      <div className="mt-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Setup editor">
        <button type="button" role="tab" aria-selected={mode === 'parking'} onClick={() => setMode('parking')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'parking' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>แก้ Parking Area</button>
        <button type="button" role="tab" aria-selected={mode === 'ground'} onClick={() => setMode('ground')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === 'ground' ? 'bg-cyan-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>แก้จุด P (Ground Map)</button>
      </div>
    </div>
    {mode === 'parking' ? <>
      <ParkingAreaSetup imageUrl={imageUrl} dimensions={dimensions} onImageChange={(url, size) => { setImageUrl(url); setDimensions(size); }} onRowsSaved={() => setRowRevision((value) => value + 1)} />
      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-800">Physical row dimensions <span className="font-normal text-slate-500">(ตั้งค่าความยาว/กว้างของแต่ละแถว)</span></summary>
        <div className="border-t border-slate-100 p-5"><PhysicalDimensionsSetup key={rowRevision} /></div>
      </details>
    </> : <GroundMapSetup imageUrl={imageUrl} />}
  </div>;
}
