'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalibrationCanvas, type CalibrationShape } from './CalibrationCanvas';
import { getCalibration, saveCalibration } from '@/lib/calibration';
import { calibrationFromShapes, nextRowId, shapesFromCalibration } from '@/lib/parkingAreaCalibration';
import { getGroundPlaneCalibration, saveGroundPlaneCalibration } from '@/lib/groundPlaneHomography';
import type { ParkingCalibration } from '@/types/calibration';

type Props = {
  imageUrl: string | null;
  dimensions: { width: number; height: number } | null;
  onImageChange: (url: string, dimensions: { width: number; height: number }) => void;
  onRowsSaved: () => void;
};

export function ParkingAreaSetup({ imageUrl, dimensions, onImageChange, onRowsSaved }: Props) {
  const [saved, setSaved] = useState<ParkingCalibration | null>(null);
  const [shapes, setShapes] = useState<CalibrationShape[]>(shapesFromCalibration(null));
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getCalibration(controller.signal).then((value) => { setSaved(value); setShapes(shapesFromCalibration(value)); }).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load parking area.'));
    return () => controller.abort();
  }, []);

  const complete = useMemo(() => shapes.length > 1 && shapes.every((shape) => shape.points.length >= 3), [shapes]);
  const chooseImage = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => onImageChange(url, { width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setMessage('Unable to load the reference image.');
    image.src = url;
  };
  const addRow = () => {
    const id = nextRowId(shapes.slice(1).map((shape) => shape.id));
    setShapes((current) => [...current, { id, label: id.replace('row_', 'R'), points: [] }]);
    setActive(shapes.length);
  };
  const deleteRow = (index: number) => {
    const row = shapes[index];
    if (!row || index === 0 || !window.confirm(`Delete ${row.label}?\n\nThis will remove its calibration geometry and physical dimensions.`)) return;
    setShapes((current) => current.filter((_, shapeIndex) => shapeIndex !== index));
    setActive(0);
  };
  const save = async () => {
    if (!dimensions || !complete) return;
    setSaving(true); setMessage(null);
    try {
      const result = await saveCalibration(calibrationFromShapes(shapes, saved?.camera_id ?? 'SPU_CAM_01', dimensions.width, dimensions.height));
      const validIds = new Set(result.rows.map((row) => row.id));
      const ground = await getGroundPlaneCalibration();
      const measuredRows = Object.fromEntries(Object.entries(ground.calibration.measured_rows).filter(([id]) => validIds.has(id as ParkingCalibration['rows'][number]['id'])));
      if (Object.keys(measuredRows).length !== Object.keys(ground.calibration.measured_rows).length) await saveGroundPlaneCalibration({ ...ground.calibration, measured_rows: measuredRows });
      setSaved(result); setShapes(shapesFromCalibration(result)); onRowsSaved(); setMessage('Parking area saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save parking area.'); }
    finally { setSaving(false); }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Parking Area</h2>
    <p className="mt-1 text-sm text-slate-500">Draw the Parking ROI and configured parking rows on the reference image.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">{imageUrl ? 'Choose another image' : 'Choose reference image'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseImage(event.target.files?.[0])} /></label>
      {shapes.map((shape, index) => <div key={shape.id} className="inline-flex overflow-hidden rounded-lg bg-slate-100"><button type="button" disabled={!imageUrl} onClick={() => setActive(index)} className={`px-3 py-2 text-sm font-semibold ${active === index ? 'bg-blue-600 text-white' : 'text-slate-700'} disabled:cursor-not-allowed disabled:opacity-50`}>{shape.label}{shape.points.length >= 3 ? ' ✓' : ' — incomplete'}</button>{index > 0 && <button type="button" aria-label={`Delete ${shape.label}`} onClick={() => deleteRow(index)} className="border-l border-slate-300 px-2 text-sm text-rose-700">Delete</button>}</div>)}
      <button type="button" onClick={addRow} disabled={!imageUrl} className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-40">+ Add Row</button>
    </div>
    {imageUrl && dimensions ? <div className="mt-4"><CalibrationCanvas imageUrl={imageUrl} imageWidth={dimensions.width} imageHeight={dimensions.height} shapes={shapes} activeIndex={active} onChange={(points) => setShapes((current) => current.map((shape, index) => index === active ? { ...shape, points } : shape))} /><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setShapes((current) => current.map((shape, index) => index === active ? { ...shape, points: shape.points.slice(0, -1) } : shape))} className="rounded-lg border px-3 py-2 text-sm">Undo point</button><button type="button" onClick={() => setShapes((current) => current.map((shape, index) => index === active ? { ...shape, points: [] } : shape))} className="rounded-lg border px-3 py-2 text-sm">Clear {shapes[active]?.label}</button><button type="button" onClick={() => void save()} disabled={!complete || saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div></div> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Saved ROI and rows are loaded. Choose the matching reference image to view or edit them.</p>}
    {!complete && <p className="mt-3 text-sm text-amber-700">Parking ROI and every row require at least three points before saving.</p>}
    {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
  </section>;
}
