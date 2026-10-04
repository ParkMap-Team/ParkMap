"use client";

import { m } from "motion/react";
import { Mascot, type MascotMood } from "@/components/mascot";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// Full-screen message with the mascot, for loading, placeholder, and failure screens.
export function MascotScreen({
  mood,
  title,
  description,
  children,
}: {
  mood: MascotMood;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh bg-background p-4 text-foreground">
      <m.div
        className="flex flex-1"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Mascot mood={mood} />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          {children && <EmptyContent>{children}</EmptyContent>}
        </Empty>
      </m.div>
    </main>
  );
}
