'use client';

import { useEffect, useState } from 'react';
import { getCalibration } from '@/lib/calibration';
import { getGroundPlaneCalibration, saveGroundPlaneCalibration } from '@/lib/groundPlaneHomography';
import { provenanceProblem } from '@/lib/groundProvenance';
import { sortRowIds } from '@/lib/parkingAreaCalibration';
import type { GroundMeasuredRow, GroundPlaneCalibration, MetricRowId } from '@/types/groundPlaneCalibration';
import { ProvenanceFields } from './ProvenanceFields';

const EMPTY_ROW: GroundMeasuredRow = { length_m: null, width_m: null, provenance: 'MEASURED' };

export function PhysicalDimensionsSetup() {
  const [calibration, setCalibration] = useState<GroundPlaneCalibration | null>(null);
  const [rowIds, setRowIds] = useState<MetricRowId[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getCalibration(controller.signal).then((parking) => {
      setRowIds(sortRowIds(parking?.rows ?? []).map((row) => row.id));
      if (!parking) {
        setMessage('ตั้งค่า Parking Area และบันทึกอย่างน้อยหนึ่งแถวก่อนกรอกขนาดจริง');
        return null;
      }
      return getGroundPlaneCalibration(controller.signal).then((ground) => setCalibration(ground.calibration));
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load dimensions.'));
    return () => controller.abort();
  }, []);
  const replace = (id: MetricRowId, row: GroundMeasuredRow) => setCalibration((current) => current ? { ...current, measured_rows: { ...current.measured_rows, [id]: row } } : current);
  const update = (id: MetricRowId, key: 'length_m' | 'width_m', value: string) => setCalibration((current) => current ? { ...current, measured_rows: { ...current.measured_rows, [id]: { ...(current.measured_rows[id] ?? EMPTY_ROW), [key]: value === '' ? null : Number(value) } } } : current);
  const save = async () => {
    if (!calibration) return;
    const invalid = rowIds.find((id) => !calibration.measured_rows[id]?.length_m || !calibration.measured_rows[id]?.width_m);
    if (invalid) { setMessage(`${invalid.replace('row_', 'R')} requires a positive length and width.`); return; }
    const incomplete = rowIds.find((id) => provenanceProblem(calibration.measured_rows[id] ?? EMPTY_ROW));
    if (incomplete) { setMessage(`${incomplete.replace('row_', 'R')} ${provenanceProblem(calibration.measured_rows[incomplete] ?? EMPTY_ROW)}.`); return; }
    setSaving(true); setMessage(null);
    try { const result = await saveGroundPlaneCalibration(calibration); setCalibration(result.calibration); setMessage('Physical dimensions saved. Update the map calibration if its status requires it.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save dimensions.'); }
    finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Physical Row Dimensions</h2><p className="mt-1 text-sm text-slate-500">Length and width used to build every configured row. Mark a dimension Estimated when it was not measured on site.</p>{calibration ? <><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rowIds.map((id) => { const row = calibration.measured_rows[id]; return <div key={id} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{id.replace('row_', 'R')}</p><label className="mt-2 block text-xs text-slate-500">Length (m)<input type="number" min="0" step="any" value={row?.length_m ?? ''} onChange={(event) => update(id, 'length_m', event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900" /></label><label className="mt-2 block text-xs text-slate-500">Width (m)<input type="number" min="0" step="any" value={row?.width_m ?? ''} onChange={(event) => update(id, 'width_m', event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-900" /></label><div className="mt-2"><ProvenanceFields label={id.replace('row_', 'R')} value={row ?? EMPTY_ROW} onChange={(next) => replace(id, next)} /></div></div>; })}</div><div className="mt-4 flex justify-end"><button type="button" onClick={() => void save()} disabled={saving || !rowIds.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save dimensions'}</button></div></> : <p className="mt-4 text-sm text-slate-500">Loading…</p>}{message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}</section>;
}
