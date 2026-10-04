"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";

function useLiffInit() {
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return;
    // The MVP only initializes LIFF. It does not read the LINE profile or identity.
    import("@line/liff")
      .then(({ default: liff }) => liff.init({ liffId }))
      .catch((error: unknown) => console.error("LIFF initialization failed", error));
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  useLiffInit();
  return (
    <QueryClientProvider client={queryClient}>
      {/* Honor the OS reduce-motion setting. LazyMotion keeps `m` components to the small domAnimation bundle. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation}>{children}</LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
