"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { GuardBoothFit } from "../api/types";

export function useParkingRecommendation(siteId: string, enabled: boolean) {
  const client = useQueryClient();
  const requestId = useRef<string | null>(null);
  const key = ["line-parking-recommendation", siteId];
  const url = `/api/sites/${encodeURIComponent(siteId)}/parking-recommendation`;
  const preference = useQuery<{ model_id: string | null }>({
    queryKey: ["parking-vehicle"], enabled, staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/vehicle-preference", { cache: "no-store" });
      if (!response.ok) throw new Error("ยืนยันรุ่นรถไม่ได้ กรุณาเปิดผ่าน LINE อีกครั้ง");
      return response.json();
    },
  });
  const query = useQuery<GuardBoothFit | null>({
    queryKey: key, enabled: enabled && !!preference.data?.model_id, retry: false,
    refetchInterval: (q) => q.state.data?.stage === "HELD" || q.state.data?.stage === "AWAITING_CONFIRMATION" ? 4000 : false,
    queryFn: async ({ signal }) => {
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("ตรวจคำแนะนำเดิมไม่ได้ กรุณาลองใหม่");
      return response.json();
    },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (id: string): Promise<GuardBoothFit> => {
      await client.cancelQueries({ queryKey: key });
      const response = await fetch(url, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "ยังแนะนำที่จอดไม่ได้ กรุณาลองใหม่");
      return body;
    },
    onSuccess: (data) => { client.setQueryData(key, data); },
  });
  const requestPlace = useCallback(() => {
    if (mutation.isPending) return;
    if (!requestId.current || query.data?.stage === "RELEASED" || query.data?.stage === "OCCUPIED_CONFIRMED" || query.data?.stage == null) requestId.current = crypto.randomUUID();
    mutation.mutate(requestId.current);
  }, [mutation, query.data?.stage]);
  return {
    ...query, isError: query.isError || mutation.isError, error: mutation.error ?? query.error,
    isRequesting: mutation.isPending, requested: mutation.isPending || query.data != null,
    family: query.data?.family ?? preference.data?.model_id, requestPlace, preferenceError: preference.isError,
  };
}
