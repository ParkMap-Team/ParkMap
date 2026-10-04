import Link from "next/link";
import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

// Rich-menu targets whose feature is not built yet. They show no availability.
export function ComingSoon({ title }: { title: string }) {
  return (
    <MascotScreen mood="happy" title={title} description="กำลังพัฒนา จะเปิดให้ใช้เร็ว ๆ นี้">
      <Button render={<Link href="/" />} nativeButton={false}>
        ดูรายการลานจอด
      </Button>
    </MascotScreen>
  );
}
