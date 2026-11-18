import { progressFill } from "@/lib/boot-progress";

/**
 * The catalogue's Progress Fill: a pink bar that eases from left to right (1300ms easeInOutCubic) as
 * real steps finish. It shows no percentage, because the steps are not equal in length. With reduced
 * motion it jumps to each step instead of easing.
 */
export function ProgressFill({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`ขั้นตอนที่ ${Math.min(done + 1, total)} จาก ${total}`}
      className="h-[9px] w-48 overflow-hidden rounded-full bg-primary/15"
    >
      <div
        className="size-full origin-left rounded-full bg-linear-to-r from-primary to-[color-mix(in_srgb,var(--color-primary)_50%,white)] transition-transform duration-[1300ms] ease-in-out-cubic motion-reduce:transition-none"
        style={{ transform: `scaleX(${progressFill(done, total)})` }}
      />
    </div>
  );
}
