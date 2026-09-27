import { Camera, CheckCircle2, Cpu, MapPin, ParkingCircle, ScanLine } from 'lucide-react';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { ParkingMap } from '@/components/parking/ParkingMap';
import { ParkingStats } from '@/components/parking/ParkingStats';
import { getParkingStatus } from '@/lib/parking';

export default async function Home() {
  const data = await getParkingStatus();
  const occupied = data.objects.filter((item) => item.status === 'occupied').length;
  const available = data.objects.filter((item) => item.status === 'available').length;
  const uncertain = data.objects.filter((item) => item.status === 'uncertain').length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="flex items-center gap-3.5">
            <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200"><ParkingCircle className="size-6" strokeWidth={2.2} /></div>
            <div><div className="flex items-baseline gap-3"><h1 className="text-xl font-bold tracking-tight">ParkMap</h1><span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">v7 preview</span></div><p className="text-sm text-slate-500">Motorcycle Parking Monitoring</p></div>
          </div>
          <SystemStatus timestamp={data.timestamp} />
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] space-y-6 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <section aria-label="Parking summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Motorcycles detected" value={occupied} icon="motorcycle" tone="blue" />
          <SummaryCard label="Available areas" value={available} icon="available" tone="green" />
          <SummaryCard label="Occupied" value={occupied} icon="occupied" tone="red" />
          <SummaryCard label="Uncertain" value={uncertain} icon="uncertain" tone="amber" />
        </section>
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div><div className="flex items-center gap-2"><ScanLine className="size-5 text-blue-600" /><h2 className="font-semibold">Live parking map</h2></div><p className="mt-1 text-sm text-slate-500">Normalized top-down view · hover an area for details</p></div>
              <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Camera {data.cameraId}</span>
            </div>
            <ParkingMap data={data} />
          </div>
          <aside className="space-y-4">
            <ParkingStats data={data} />
            <InfoCard icon={<Camera />} title="Camera status" status="Online">Fixed camera {data.cameraId} · feed stable</InfoCard>
            <InfoCard icon={<Cpu />} title="Detection model" status="Mock data">ParkMap v7 pipeline ready for API connection</InfoCard>
            <InfoCard icon={<MapPin />} title="Current zone" status="Active">{data.zone.name} · one parking ROI monitored</InfoCard>
          </aside>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ icon, title, status, children }: { icon: React.ReactNode; title: string; status: string; children: React.ReactNode }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 [&>svg]:size-5">{icon}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{title}</h3><span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" /> {status}</span></div><p className="mt-1.5 text-sm leading-5 text-slate-500">{children}</p></div></div></article>;
}
