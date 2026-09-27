import { AlertTriangle, MapPinned } from 'lucide-react';
import type { DetectionRowAssignment, ParkingCalibration } from '@/types/calibration';

export function RowAssignmentSummary({
  detectedCount,
  calibration,
  assignments,
  state,
  aspectRatioMismatch,
  error,
}: {
  detectedCount: number;
  calibration: ParkingCalibration | null;
  assignments: DetectionRowAssignment[];
  state: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  aspectRatioMismatch: boolean;
  error?: string | null;
}) {
  const count = (status: DetectionRowAssignment['status']) => assignments.filter((assignment) => assignment.status === status).length;
  const outside = count('OUTSIDE_ROI');
  const assigned = count('ASSIGNED');
  const unassigned = count('UNASSIGNED');
  const ambiguous = count('AMBIGUOUS');

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><MapPinned className="size-5 text-blue-600" /><h2 className="font-semibold">Parking Row Assignment</h2></div>
      {state === 'loading' && <p className="mt-3 text-sm text-slate-500">Loading parking calibration…</p>}
      {state === 'missing' && <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Parking calibration has not been configured. Motorcycle detection is available, but row assignment cannot be calculated.</div>}
      {state === 'error' && <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? 'Parking calibration could not be loaded. Motorcycle detection remains available.'}</div>}
      {state === 'ready' && calibration && <>
        {aspectRatioMismatch && <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>This image does not match the calibrated camera aspect ratio. Row assignment may be inaccurate.</span></div>}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <AssignmentMetric label="Motorcycles detected" value={detectedCount} />
          <AssignmentMetric label="Inside parking ROI" value={detectedCount - outside} />
          <AssignmentMetric label="Outside ROI" value={outside} />
          <AssignmentMetric label="Assigned to rows" value={assigned} />
          <AssignmentMetric label="Unassigned" value={unassigned} />
          <AssignmentMetric label="Ambiguous" value={ambiguous} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4 text-sm sm:grid-cols-5">
          {calibration.rows.map((row) => <AssignmentMetric key={row.id} label={row.name.replace('Parking ', '')} value={assignments.filter((assignment) => assignment.row_id === row.id).length} suffix="motorcycles" />)}
        </div>
        <p className="mt-4 text-xs text-slate-500">These counts describe detected motorcycles assigned to calibrated geometric rows. They are not parking capacity or availability.</p>
      </>}
    </section>
  );
}

function AssignmentMetric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}{suffix && <span className="ml-1 text-xs font-normal text-slate-500">{suffix}</span>}</p></div>;
}
