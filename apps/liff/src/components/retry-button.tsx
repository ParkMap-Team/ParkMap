"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Fetches the current page's server data again. */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" className="h-11 px-5" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      <RotateCw data-icon="inline-start" aria-hidden />
      {pending ? "กำลังลองใหม่" : "ลองใหม่"}
    </Button>
  );
}
