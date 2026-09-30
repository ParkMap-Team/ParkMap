"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
