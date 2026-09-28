"use client";

import { ParkMapBrand } from '@/components/dashboard/ParkMapBrand';
import { ImageAnalyzer } from '@/components/camera/ImageAnalyzer';

export function DashboardClient() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8"><ParkMapBrand /></div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:py-8">
        <ImageAnalyzer />
      </div>
    </main>
  );
}
