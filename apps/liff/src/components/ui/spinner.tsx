import { cn } from "@/lib/utils";

/**
 * The catalogue's Spinner Arc: a half-circle arc in the brand pink turning on a faint track. With
 * reduced motion it stays a still arc, and the text beside it carries the meaning.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 rounded-full border-2 border-current/20 border-t-primary border-r-primary motion-safe:animate-spinner-arc", className)}
    />
  );
}
