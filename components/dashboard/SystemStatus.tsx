import { Radio } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { DataSourceMode, SystemState } from '@/types/parking';

export function SystemStatus({ timestamp, status, mode }: { timestamp?: string; status: SystemState; mode: DataSourceMode }) {
  const formatted = timestamp ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok', hour12: false }).format(new Date(timestamp)) : '—';
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"><StatusBadge status={status} /><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${mode === 'demo' ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>{mode === 'demo' ? 'DEMO DATA' : 'LIVE'}</span><span className="inline-flex items-center gap-2 text-slate-500"><Radio className="size-4" /> Last updated {formatted} ICT</span></div>;
}
