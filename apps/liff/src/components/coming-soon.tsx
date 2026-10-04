"use client";

import { Construction } from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// Rich-menu targets whose feature is not built yet. They show no availability.
export function ComingSoon({ title }: { title: string }) {
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
            <EmptyMedia variant="icon">
              <Construction />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>กำลังพัฒนา จะเปิดให้ใช้เร็ว ๆ นี้</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/" />} nativeButton={false}>
              ดูรายการลานจอด
            </Button>
          </EmptyContent>
        </Empty>
      </m.div>
    </main>
  );
}
