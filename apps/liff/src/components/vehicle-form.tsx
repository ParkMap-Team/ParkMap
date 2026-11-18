"use client";
import { Check } from "lucide-react";
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
    <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-model`} className="text-sm font-semibold">รุ่นรถของคุณ</label>
        <select
          id={`${id}-model`}
          value={model}
          onChange={(event) => { setModel(event.target.value); setConfirmed(false); }}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-11 w-full rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="" disabled>เลือกรุ่นรถ</option>
          {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {error && <p id={`${id}-error`} key={failures} role="alert" className="text-sm font-semibold text-destructive motion-safe:animate-error-shake">{error}</p>}
      <Button type="submit" disabled={!model || busy || unchanged} className="h-11">
        {busy ? "กำลังบันทึก" : submitLabel}
      </Button>
      {confirmed && (
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Check aria-hidden className="size-4 motion-safe:animate-icon-pop" />
          บันทึกรุ่นรถแล้ว
        </p>
      )}
    </form>
  );
}
