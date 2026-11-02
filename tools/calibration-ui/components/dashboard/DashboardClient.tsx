"use client";

import { ParkMapBrand } from '@/components/dashboard/ParkMapBrand';
import { ImageAnalyzer } from '@/components/camera/ImageAnalyzer';
import { SetupWorkspace } from '@/components/setup/SetupWorkspace';
import { AnnotationWorkspace } from '@/components/annotation/AnnotationWorkspace';
import { useState } from 'react';

type View = 'PARKING' | 'SETUP' | 'LABEL';
export function DashboardClient({ initialView = 'PARKING', initialSetupTab = 'camera' }: { initialView?: View; initialSetupTab?: 'camera' | 'lot' }) {
  const [view, setView] = useState<View>(initialView);
  const [visited, setVisited] = useState(() => new Set<View>([initialView]));
  const open = (next: View) => { setView(next); setVisited((old) => new Set([...old, next])); };
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8"><ParkMapBrand /><nav className="flex rounded-xl bg-slate-100 p-1" aria-label="ParkMap areas">
          <button type="button" aria-pressed={view === 'PARKING'} onClick={() => open('PARKING')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'PARKING' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Parking</button>
          <button type="button" aria-pressed={view === 'SETUP'} onClick={() => open('SETUP')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'SETUP' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Setup</button>
          <button type="button" aria-pressed={view === 'LABEL'} onClick={() => open('LABEL')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'LABEL' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Label</button>
        </nav></div>
      </header>
      <div className={`mx-auto px-5 py-6 sm:px-8 lg:py-8 ${view === 'PARKING' ? 'max-w-6xl' : 'max-w-[1600px]'}`}>
        {visited.has('PARKING') && <div hidden={view !== 'PARKING'}><ImageAnalyzer onOpenSetup={() => open('SETUP')} /></div>}
        {visited.has('SETUP') && <div hidden={view !== 'SETUP'}><SetupWorkspace initialTab={initialSetupTab} /></div>}
        {visited.has('LABEL') && <div hidden={view !== 'LABEL'}><AnnotationWorkspace /></div>}
      </div>
    </main>
  );
}
