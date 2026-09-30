"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs`, so ageing data is re-evaluated between polls. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
