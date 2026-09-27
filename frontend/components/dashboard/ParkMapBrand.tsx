'use client';

import { ParkingCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PARKMAP_LOGO_PATH, shouldDisplayParkMapLogo, type LogoLoadState } from '@/lib/branding';

export function ParkMapBrand() {
  const [logoState, setLogoState] = useState<LogoLoadState>('checking');
  useEffect(() => {
    const probe = new Image();
    probe.onload = () => setLogoState('loaded'); probe.onerror = () => setLogoState('missing'); probe.src = PARKMAP_LOGO_PATH;
    return () => { probe.onload = null; probe.onerror = null; };
  }, []);
  const showLogo = shouldDisplayParkMapLogo(logoState);
  return <div className="flex items-center gap-4">{showLogo ? <img src={PARKMAP_LOGO_PATH} alt="ParkMap logo" onError={() => setLogoState('missing')} className="h-16 w-auto max-w-44 shrink-0 object-contain sm:h-20 sm:max-w-56" /> : <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-200 sm:size-20" aria-hidden="true"><ParkingCircle className="size-8 sm:size-10" /></div>}<div><div className="flex items-baseline gap-3"><h1 className="text-xl font-bold tracking-tight">ParkMap</h1><span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">v7.1 frontend</span></div><p className="text-sm text-slate-500">Motorcycle Parking Monitoring</p></div></div>;
}
