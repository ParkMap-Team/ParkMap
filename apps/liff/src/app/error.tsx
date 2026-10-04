"use client";

import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

// The error message is not shown: it can carry server details. Next logs it on the server.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <MascotScreen mood="confused" title="เกิดข้อผิดพลาด" description="โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง">
      <Button onClick={reset}>ลองใหม่</Button>
    </MascotScreen>
  );
}
