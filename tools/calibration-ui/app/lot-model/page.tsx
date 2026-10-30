import { ParkMapBrand } from '../../components/dashboard/ParkMapBrand';
import Link from 'next/link';
import { LotModelEditor } from '../../components/lot-model/LotModelEditor';

export default function LotModelPage() {
  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <ParkMapBrand /><Link href="/" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">กลับไป Parking / Setup</Link>
    </div></header>
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:py-8"><LotModelEditor /></div>
  </main>;
}
