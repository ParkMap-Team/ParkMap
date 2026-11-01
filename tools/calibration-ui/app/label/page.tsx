import Link from 'next/link';
import { ParkMapBrand } from '../../components/dashboard/ParkMapBrand';
import { AnnotationWorkspace } from '../../components/annotation/AnnotationWorkspace';

export default function LabelPage() {
  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-5">
      <ParkMapBrand /><Link href="/">Parking / Setup</Link>
    </div></header>
    <div className="mx-auto max-w-[1600px] px-5 py-6"><AnnotationWorkspace /></div>
  </main>;
}
