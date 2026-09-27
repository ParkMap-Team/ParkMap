import type { SystemState } from '@/types/parking';

const styles: Record<SystemState, string> = {
  loading: 'bg-slate-100 text-slate-600 ring-slate-200',
  online: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  processing: 'bg-blue-50 text-blue-700 ring-blue-200',
  stale: 'bg-amber-50 text-amber-800 ring-amber-200',
  offline: 'bg-slate-100 text-slate-700 ring-slate-300',
  error: 'bg-red-50 text-red-700 ring-red-200',
};

export function StatusBadge({ status, label }: { status: SystemState; label?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${styles[status]}`}><span className={`size-1.5 rounded-full ${status === 'online' ? 'bg-emerald-500' : status === 'processing' ? 'bg-blue-500' : status === 'error' ? 'bg-red-500' : status === 'stale' ? 'bg-amber-500' : 'bg-slate-400'}`} />{label ?? status}</span>;
}
