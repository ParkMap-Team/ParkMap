"use client";

import { Check, X } from "lucide-react";

/** Uses the same map-anchored wine callout as the saved-parking prompt. */
export function ReserveSpotPrompt({ busy, error, onConfirm, onClose }: {
  busy: boolean; error: string; onConfirm(): void; onClose(): void;
}) {
  return (
    <div role="group" aria-label="ยืนยันจองจุดที่เลือก" className="w-56 overflow-hidden rounded-xl">
      <div className="flex min-h-11">
        <button type="button" disabled={busy} onClick={onConfirm}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 text-xs font-semibold outline-none hover:bg-white/10 focus-visible:bg-white/10 disabled:opacity-60">
          <Check aria-hidden className="size-4 shrink-0" />
          <span aria-live="polite">{busy ? "กำลังตรวจและจอง…" : "ยืนยันจองจุดนี้"}</span>
        </button>
        <button type="button" disabled={busy} onClick={onClose} aria-label="ยกเลิกเลือกจุดจอด"
          className="grid w-11 shrink-0 place-items-center border-l border-white/15 outline-none hover:bg-white/10 focus-visible:bg-white/10 disabled:opacity-60">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      {error && <p role="alert" className="border-t border-white/15 px-3 py-2 text-xs text-pretty">{error}</p>}
    </div>
  );
}
