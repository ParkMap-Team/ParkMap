"use client";

import { ParkMapBrand } from '@/components/dashboard/ParkMapBrand';
import { ImageAnalyzer } from '@/components/camera/ImageAnalyzer';
import { SetupPage } from '@/components/setup/SetupPage';
import { useState } from 'react';

export function DashboardClient() {
  const [view, setView] = useState<'PARKING' | 'SETUP'>('PARKING');
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8"><ParkMapBrand /><nav className="flex rounded-xl bg-slate-100 p-1" aria-label="ParkMap areas"><button type="button" onClick={() => setView('PARKING')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'PARKING' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Parking</button><button type="button" onClick={() => setView('SETUP')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === 'SETUP' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>Setup</button></nav></div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:py-8">
        {view === 'PARKING' ? <ImageAnalyzer onOpenSetup={() => setView('SETUP')} /> : <SetupPage />}
      </div>
    </main>
  );
}
