import { Radio } from 'lucide-react';
export function SystemStatus({ timestamp }: { timestamp: string }) {
  const formatted = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false }).format(new Date(timestamp));
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><span className="inline-flex items-center gap-2 font-semibold text-emerald-700"><span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" /><span className="relative size-2.5 rounded-full bg-emerald-500" /></span>System operational</span><span className="inline-flex items-center gap-2 text-slate-500"><Radio className="size-4" /> Last updated {formatted} ICT</span></div>;
}
