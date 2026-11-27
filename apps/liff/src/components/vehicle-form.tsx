"use client";
import { Check, Motorbike } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Preference } from "@/lib/vehicle-session";

/** Chooses the student's model. `onSave` throws a message to show when saving fails. */
export function VehicleForm({ models, initial, submitLabel, onSave }: { models: Preference["models"]; initial: string; submitLabel: string; onSave(modelId: string): Promise<void> }) {
  const id = useId();
  const [model, setModel] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState(0);
  async function save() {
    setBusy(true); setError("");
    try {
      await onSave(model);
      setSaved(model);
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setFailures((count) => count + 1);
    } finally { setBusy(false); }
  }
  const unchanged = model === saved;
  return (
    <form className="mt-6 flex flex-col" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <section aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="px-1 pb-2 text-sm text-primary-foreground/90">เลือกรุ่นรถ</h2>
        <label htmlFor={`${id}-model`} className="flex min-h-14 items-center gap-3 overflow-hidden rounded-2xl border bg-card px-4 focus-within:ring-3 focus-within:ring-ring/50">
          <Motorbike aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-foreground">รุ่นรถ</span>
          <select
            id={`${id}-model`}
            value={model}
            onChange={(event) => { setModel(event.target.value); setConfirmed(false); }}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-14 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-right text-base text-muted-foreground outline-none"
          >
            <option value="" disabled>เลือกรุ่นรถ</option>
            {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </section>
      {error && <p id={`${id}-error`} key={failures} role="alert" className="px-1 pt-2 text-sm font-semibold text-primary-foreground motion-safe:animate-error-shake">{error}</p>}
      <Button type="submit" disabled={!model || busy || unchanged} className="mt-5 h-11 w-full bg-background text-primary hover:bg-background/90 disabled:bg-background/75 disabled:text-primary/70 disabled:opacity-100">
        {busy ? "กำลังบันทึก" : submitLabel}
      </Button>
      {confirmed && (
        <p role="status" className="mt-3 flex items-center justify-center gap-2 text-sm text-primary-foreground">
          <Check aria-hidden className="size-4 motion-safe:animate-icon-pop" />
          บันทึกรุ่นรถแล้ว
        </p>
      )}
    </form>
  );
}
