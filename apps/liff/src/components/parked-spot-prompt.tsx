"use client";

import { useMutation } from "@tanstack/react-query";
import { BookmarkPlus, Check, X } from "lucide-react";
import Link from "next/link";
import type { ParkedSpotInput } from "@/lib/parked-spot";

async function saveSpot(spot: ParkedSpotInput): Promise<void> {
  const response = await fetch("/api/parked-spot", {
    method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spot),
  });
  if (!response.ok) throw new Error(`Saving the parked spot failed with ${response.status}`);
}

const ACTION = "flex min-w-0 flex-1 items-center gap-1.5 pr-1 pl-3 text-xs font-semibold outline-none hover:bg-white/10 focus-visible:bg-white/10 disabled:text-white/60";

/**
 * One compact row over the recommended place's pin, once the route has drawn, offering to save it as
 * where the rider parked (ADR 0021). It keeps one size in every state, because the map places it, and
 * stays small so it covers little of the lot. The map's callout gives it its surface and tail.
 */
export function ParkedSpotPrompt({ spot, onClose }: { spot: ParkedSpotInput; onClose(): void }) {
  const save = useMutation({ mutationFn: saveSpot });
  return (
    <div role="group" aria-label="บันทึกที่จอด" className="flex h-9 w-44 overflow-hidden rounded-xl">
      {save.isSuccess ? (
        <Link href="/parked" className={ACTION}>
          <Check aria-hidden className="size-4 shrink-0 motion-safe:animate-icon-pop" />
          <span className="truncate motion-safe:animate-content-swap" aria-live="polite">บันทึกแล้ว ดูที่จอด</span>
        </Link>
      ) : (
        <button type="button" className={`${ACTION} ${save.isError ? "motion-safe:animate-error-shake" : ""}`} disabled={save.isPending} onClick={() => save.mutate(spot)}>
          <BookmarkPlus aria-hidden className="size-4 shrink-0" />
          <span key={save.status} className="truncate motion-safe:animate-content-swap" aria-live="polite">
            {save.isPending ? "กำลังบันทึก" : save.isError ? "ไม่สำเร็จ ลองใหม่" : "บันทึกที่จอด"}
          </span>
        </button>
      )}
      <button type="button" aria-label="ปิด" className="grid w-9 shrink-0 place-items-center border-l border-white/15 text-white/70 outline-none hover:bg-white/10 focus-visible:bg-white/10" onClick={onClose}>
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
