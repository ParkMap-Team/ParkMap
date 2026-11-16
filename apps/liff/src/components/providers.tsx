"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useState } from "react";
import { VehicleGate } from "./vehicle-gate";


export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {/* Honor the OS reduce-motion setting. LazyMotion keeps `m` components to the small domAnimation bundle. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}><VehicleGate>{children}</VehicleGate></LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
