"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useRef, useState } from "react";
import { isMapPath } from "@/lib/tabs";

/**
 * The parking guide's switch. `presses` counts each start, so the map asks for a place again;
 * `claim` is true once per press, so a map that mounts or re-renders does not ask twice. The request
 * and its ID live with the map's recommendation, which keeps them across a refresh.
 */
type Guide = { active: boolean; presses: number; claim(): boolean; start(): void; stop(): void };
const GuideContext = createContext<Guide>({ active: false, presses: 0, claim: () => false, start() {}, stop() {} });

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
  const guide: Guide = {
    active,
    presses,
    claim() {
      if (claimed.current === presses) return false;
      claimed.current = presses;
      return true;
    },
    start() {
      setActive(true);
      setPresses((count) => count + 1);
      if (!isMapPath(pathname)) router.push("/");
    },
    stop() {
      setActive(false);
      claimed.current = presses;
    },
  };
  return <GuideContext value={guide}>{children}</GuideContext>;
}
