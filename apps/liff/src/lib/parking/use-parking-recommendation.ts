"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { GuardBoothFit } from "../api/types";
import { parkingRequestId } from "./recommendation-request";

export function useParkingRecommendation(siteId: string, enabled: boolean, observedAt: string | null | undefined) {
  const preference = useQuery<{ model_id: string | null }>({
    queryKey: ["parking-vehicle"], enabled, staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/vehicle-preference", { cache: "no-store" });
      if (!response.ok) throw new Error("ยืนยันรุ่นรถไม่ได้ กรุณาเปิดผ่าน LINE อีกครั้ง");
      return response.json();
    },
  });
  const family = preference.data?.model_id;
  const key = `${siteId}:LINE:${family}`;
  const [request, setRequest] = useState<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!enabled || !family) return;
    try {
      // Only restore a request the rider previously initiated explicitly.
      if (sessionStorage.getItem(`parkmap:recommendation:${key}`)) setRequest({ key, id: parkingRequestId(sessionStorage, key) });
    } catch { /* No browser storage; the rider can still request in this visit. */ }
  }, [enabled, family, key]);
  const id = request?.key === key ? request.id : null;
  const query = useQuery<GuardBoothFit>({
    queryKey: ["line-parking-recommendation", siteId, id, observedAt],
    enabled: enabled && !!id && !!family && !!observedAt,
    retry: false, refetchInterval: 4000,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/parking-recommendation`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: id, observed_at: observedAt }), signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "ยังแนะนำที่จอดไม่ได้ กรุณาลองใหม่");
      return body;
    },
  });
  return {
    ...query, requested: !!id, family,
    requestPlace: () => {
      if (!family) return;
      let storage: Storage | null = null;
      try { storage = sessionStorage; } catch { /* Disabled storage. */ }
      // An explicit new request after a terminal outcome gets a new ID. Refresh
      // and network retries continue using the existing ID and original expiry.
      if (query.data?.stage === "RELEASED" || query.data?.stage === "OCCUPIED_CONFIRMED") {
        try { storage?.removeItem(`parkmap:recommendation:${key}`); } catch { /* Disabled storage. */ }
        setRequest({ key, id: parkingRequestId(storage, key) });
      } else if (id) void query.refetch();
      else setRequest({ key, id: parkingRequestId(storage, key) });
    },
    preferenceError: preference.isError,
  };
}
