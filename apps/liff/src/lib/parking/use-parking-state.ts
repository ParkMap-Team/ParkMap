"use client";

import { useQuery } from "@tanstack/react-query";
import type { SiteParkingState } from "../api/types.ts";

export const PARKING_STATE_POLL_MS = 4000;

/**
 * `booth` reads the public guard-booth map; `rider` asks for a rider's map, with free ground only where
 * the LINE account's saved model fits.
 */
export function useParkingState(siteId: string, view: "booth" | "rider") {
  return useQuery({
    queryKey: ["parking-state", siteId, view],
    queryFn: async ({ signal }): Promise<SiteParkingState> => {
      const site = encodeURIComponent(siteId);
      const response = await fetch(view === "booth" ? `/api/guard-booth/sites/${site}/parking-state` : `/api/sites/${site}/parking-state?view=rider`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Parking state request failed with ${response.status}`);
      return response.json();
    },
    refetchInterval: PARKING_STATE_POLL_MS,
    retry: 1,
  });
}
