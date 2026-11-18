"use client";

import { m } from "motion/react";
import { Mascot, type MascotMood } from "@/components/mascot";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// A screen-filling message with the mascot, for placeholder and failure screens. `shakeKey` counts
// failed retries: each one shakes the message once, so a retry that fails again is still noticed.
export function MascotScreen({
  mood,
  title,
  description,
  shakeKey = 0,
  children,
}: {
  mood: MascotMood;
  title: string;
  description: string;
  shakeKey?: number;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 bg-background px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,var(--safe-bottom))] text-foreground">
      <m.div
        className="flex flex-1"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        <Empty>
          <EmptyHeader key={shakeKey} className={shakeKey > 0 ? "motion-safe:animate-error-shake" : undefined}>
            <EmptyMedia>
              <Mascot mood={mood} />
            </EmptyMedia>
            <EmptyTitle className="text-balance">{title}</EmptyTitle>
            <EmptyDescription className="text-pretty">{description}</EmptyDescription>
          </EmptyHeader>
          {children && <EmptyContent>{children}</EmptyContent>}
        </Empty>
      </m.div>
    </main>
  );
}
