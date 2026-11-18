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

const ACTION = "flex min-w-0 flex-1 items-center gap-2 px-3 text-sm font-semibold outline-none hover:bg-muted focus-visible:bg-muted disabled:text-muted-foreground";

/**
 * One row over the recommended place's pin, once the route has drawn, offering to save it as where
 * the rider parked (ADR 0021). It keeps one size in every state, because the map places it.
 */
export function ParkedSpotPrompt({ spot, onClose }: { spot: ParkedSpotInput; onClose(): void }) {
  const save = useMutation({ mutationFn: saveSpot });
  return (
    <div role="group" aria-label="บันทึกที่จอด" className="flex h-11 w-64 overflow-hidden rounded-xl bg-background text-foreground shadow-md ring-1 ring-black/10">
      {save.isSuccess ? (
        <Link href="/parked" className={ACTION}>
          <Check aria-hidden className="size-4 shrink-0" />
          <span className="truncate" aria-live="polite">บันทึกแล้ว ดูที่จอด</span>
        </Link>
      ) : (
        <button type="button" className={ACTION} disabled={save.isPending} onClick={() => save.mutate(spot)}>
          <BookmarkPlus aria-hidden className="size-4 shrink-0" />
          <span className="truncate" aria-live="polite">
            {save.isPending ? "กำลังบันทึก" : save.isError ? "บันทึกไม่สำเร็จ ลองใหม่" : "บันทึกว่าฉันจอดตรงนี้"}
          </span>
        </button>
      )}
      <button type="button" aria-label="ปิด" className="grid w-11 shrink-0 place-items-center border-l text-muted-foreground outline-none hover:bg-muted focus-visible:bg-muted" onClick={onClose}>
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
