"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelRecommendation, waitForRecommendationRequests } from "@/lib/parking/cancel-recommendation";
import { isMapPath } from "@/lib/tabs";

/**
 * The parking guide's switch. `presses` counts each start, so the map asks for a place again;
 * `claim` is true once per press, so a map that mounts or re-renders does not ask twice. The request
 * and its ID live with the map's recommendation, which keeps them across a refresh.
 */
type Guide = { active: boolean; presses: number; cancelling: boolean; cancelError: string | null; claim(): boolean; start(): void; resume(): void; stop(): void };
const GuideContext = createContext<Guide>({ active: false, presses: 0, cancelling: false, cancelError: null, claim: () => false, start() {}, resume() {}, stop() {} });

export function useGuide(): Guide {
  return use(GuideContext);
}

// The tab bar's centre button starts a request and the map shows its answer, so the switch lives
// above both. From another tab it opens the home map first.
export function GuideProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [presses, setPresses] = useState(0);
  const claimed = useRef(0);
  const client = useQueryClient();
  const cancellation = useMutation({
    mutationKey: ["line-parking-recommendation-cancel"], retry: false,
    mutationFn: async () => {
      await waitForRecommendationRequests(client);
      const key = ["line-parking-recommendation", "sripatum"];
      await client.cancelQueries({ queryKey: key });
      await cancelRecommendation();
      client.setQueryData(key, null);
      await client.invalidateQueries({ queryKey: ["parking-state"] });
    },
    onSuccess: () => { setActive(false); claimed.current = presses; },
  });
  const guide: Guide = {
    active,
    presses,
    cancelling: cancellation.isPending,
    cancelError: cancellation.isError ? "ยกเลิกคำแนะนำไม่สำเร็จ กรุณาลองอีกครั้ง" : null,
    resume() { setActive(true); },
    claim() {
      if (claimed.current === presses) return false;
      claimed.current = presses;
      return true;
    },
    start() {
      if (cancellation.isPending) return;
      cancellation.reset();
      setActive(true);
      setPresses((count) => count + 1);
      if (!isMapPath(pathname)) router.push("/");
    },
    stop() {
      if (!cancellation.isPending) cancellation.mutate();
    },
  };
  return <GuideContext value={guide}>{children}</GuideContext>;
}
