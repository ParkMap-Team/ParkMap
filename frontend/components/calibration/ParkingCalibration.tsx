'use client';

import { Check, ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CalibrationCanvas, type CalibrationShape } from '@/components/calibration/CalibrationCanvas';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCalibration, saveCalibration } from '@/lib/calibration';
import type { CalibrationPoint, ParkingCalibration as ParkingCalibrationData } from '@/types/calibration';
import type { Detection } from '@/types/detection';

const definitions = [
  { id: 'parking_roi', label: 'Parking ROI' },
  ...Array.from({ length: 5 }, (_, index) => ({ id: `row_${index + 1}`, label: `Row ${index + 1}` })),
];

function emptyShapes(): CalibrationShape[] {
  return definitions.map((definition) => ({ ...definition, points: [] }));
}

function shapesFromCalibration(calibration: ParkingCalibrationData | null): CalibrationShape[] {
  if (!calibration) return emptyShapes();
  return [
    { ...definitions[0], points: calibration.parking_roi.polygon },
    ...definitions.slice(1).map((definition, index) => ({ ...definition, points: calibration.rows[index]?.polygon ?? [] })),
  ];
}

export function ParkingCalibration({
  open,
  onOpenChange,
  imageUrl,
  imageWidth,
  imageHeight,
  cameraId,
  detections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  cameraId: string;
  detections: Detection[];
}) {
  const [step, setStep] = useState(0);
  const [shapes, setShapes] = useState<CalibrationShape[]>(emptyShapes);
  const [showDetections, setShowDetections] = useState(detections.length > 0);
  const [state, setState] = useState<'loading' | 'editing' | 'saving'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void getCalibration(controller.signal)
      .then((calibration) => setShapes(shapesFromCalibration(calibration)))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setShapes(emptyShapes());
        setMessage(error instanceof Error ? error.message : 'Unable to load calibration.');
      })
      .finally(() => { if (!controller.signal.aborted) setState('editing'); });
    return () => controller.abort();
  }, [open, detections.length]);

  const complete = useMemo(() => shapes.map((shape) => shape.points.length >= 3), [shapes]);
  const canSave = complete.every(Boolean);
  const updateCurrent = (points: CalibrationPoint[]) => setShapes((current) => current.map((shape, index) => index === step ? { ...shape, points } : shape));

  const save = async () => {
    if (!canSave) return;
    setState('saving');
    setMessage(null);
    const payload: ParkingCalibrationData = {
      schema_version: 2,
      camera_id: cameraId,
      reference_image: { width: imageWidth, height: imageHeight },
      parking_roi: { polygon: shapes[0].points },
      rows: shapes.slice(1).map((shape, index) => ({
        id: `row_${index + 1}` as `row_${1 | 2 | 3 | 4 | 5}`,
        name: `Parking Row ${index + 1}` as `Parking Row ${1 | 2 | 3 | 4 | 5}`,
        polygon: shape.points,
      })),
    };
    try {
      const saved = await saveCalibration(payload);
      setShapes(shapesFromCalibration(saved));
      setMessage('Calibration saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save calibration.');
    } finally {
      setState('editing');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-dvh! w-screen! max-w-none! grid-rows-none flex-col gap-2 overflow-hidden rounded-none p-2 sm:max-w-none! sm:p-3">
        <DialogHeader className="shrink-0 px-1">
          <DialogTitle>Parking calibration</DialogTitle>
          <DialogDescription>Step {step + 1} / 6 · {definitions[step].label}. Click to add points; drag a vertex to fine-tune it.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 lg:grid-cols-[minmax(0,1fr)_13rem] lg:grid-rows-1">
          {state === 'loading'
            ? <div className="grid min-h-72 place-items-center rounded-xl bg-slate-950 text-white"><LoaderCircle className="size-7 animate-spin" aria-label="Loading calibration" /></div>
            : <CalibrationCanvas imageUrl={imageUrl} imageWidth={imageWidth} imageHeight={imageHeight} shapes={shapes} activeIndex={step} detections={detections} showDetections={showDetections} onChangeActive={updateCurrent} />}

          <aside className="flex max-h-44 min-h-0 flex-col gap-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2 lg:max-h-none">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completion</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                {definitions.map((definition, index) => (
                  <button key={definition.id} type="button" onClick={() => setStep(index)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${step === index ? 'bg-blue-600 font-semibold text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>
                    <span>{definition.label}</span>
                    {complete[index] ? <Check className="size-4" /> : <span className={`text-xs ${step === index ? 'text-blue-100' : 'text-slate-400'}`}>Missing</span>}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5 text-sm text-slate-700">
              <span>Show YOLO detections</span>
              <input type="checkbox" checked={showDetections} disabled={detections.length === 0} onChange={(event) => setShowDetections(event.target.checked)} className="size-4 accent-blue-600" />
            </label>
            <p className="text-xs text-slate-500">{shapes[step].points.length} points · minimum 3</p>
            {message && <p role="status" className={`rounded-lg px-3 py-2 text-xs ${message === 'Calibration saved.' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message}</p>}
          </aside>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto border-t border-slate-200 pt-2">
          <Button className="shrink-0" variant="outline" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || state !== 'editing'}><ChevronLeft />Previous</Button>
          <Button className="shrink-0" variant="outline" onClick={() => setStep((value) => Math.min(5, value + 1))} disabled={step === 5 || state !== 'editing'}>Next<ChevronRight /></Button>
          <Button className="shrink-0" variant="outline" onClick={() => updateCurrent(shapes[step].points.slice(0, -1))} disabled={shapes[step].points.length === 0 || state !== 'editing'}><Undo2 />Undo point</Button>
          <Button className="shrink-0" variant="outline" onClick={() => updateCurrent([])} disabled={shapes[step].points.length === 0 || state !== 'editing'}><Trash2 />Clear current</Button>
          <Button className="shrink-0" variant="outline" onClick={() => { setShapes(emptyShapes()); setStep(0); setMessage(null); }} disabled={state !== 'editing'}><RotateCcw />Reset all</Button>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={state === 'saving'}>Cancel</Button>
            <Button onClick={() => void save()} disabled={!canSave || state !== 'editing'}><Save />{state === 'saving' ? 'Saving…' : 'Save calibration'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
