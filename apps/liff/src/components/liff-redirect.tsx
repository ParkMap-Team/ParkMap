"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MascotLoading } from "@/components/mascot";

/** How long to wait for LIFF to open the requested page before offering the home screen. */
const GIVE_UP_MS = 8000;

// Shown while liff.init forwards a rich-menu link (`liff.state`) to its page, so the home map does not
// load and flash first. If LIFF never forwards, the student can still reach the home screen.
export function LiffRedirect() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="grid flex-1 place-items-center bg-background p-4">
      <div className="flex flex-col items-center gap-4">
        <MascotLoading label="กำลังเปิดหน้า" />
        {stuck && (
          <Link href="/" className="flex min-h-11 items-center px-3 text-sm underline underline-offset-4 motion-safe:animate-screen-enter">
            ไปหน้าแรก
          </Link>
        )}
      </div>
    </main>
  );
}
