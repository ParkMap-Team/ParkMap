import type { ParkingMapData, ParkingStatus } from '@/types/parking';

const rows: { status: ParkingStatus; label: string; color: string }[] = [
  { status: 'occupied', label: 'Occupied', color: 'bg-red-500' },
  { status: 'available', label: 'Available', color: 'bg-emerald-500' },
  { status: 'uncertain', label: 'Uncertain', color: 'bg-amber-400' },
];

export function ParkingStats({ data }: { data: ParkingMapData }) {
  const total = data.objects.length;
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Area classification</h2><span className="text-xs font-medium text-slate-400">{total} regions</span></div><div className="mt-5 space-y-4">{rows.map((row) => { const count = data.objects.filter((item) => item.status === row.status).length; const percentage = total === 0 ? 0 : (count / total) * 100; return <div key={row.status}><div className="mb-1.5 flex justify-between text-sm"><span className="text-slate-600">{row.label}</span><strong>{count}</strong></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${row.color}`} style={{ width: `${percentage}%` }} /></div></div>; })}</div><p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Uncertain regions require review and are never counted as available.</p></article>;
}
