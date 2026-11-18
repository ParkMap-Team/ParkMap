"use client";

import { useQuery } from "@tanstack/react-query";
import type { SiteParkingState } from "../api/types.ts";

export const PARKING_STATE_POLL_MS = 4000;

export function useParkingState(siteId: string, booth = false) {
  return useQuery({
    queryKey: ["parking-state", siteId, booth],
    queryFn: async ({ signal }): Promise<SiteParkingState> => {
      const response = await fetch(`${booth ? "/api/guard-booth" : "/api"}/sites/${encodeURIComponent(siteId)}/parking-state`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Parking state request failed with ${response.status}`);
      return response.json();
    },
    refetchInterval: PARKING_STATE_POLL_MS,
    retry: 1,
  });
}
