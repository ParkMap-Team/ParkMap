"use client";

import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

// The error message is not shown: it can carry server details. Next logs it on the server.
// `retry` fetches the server data again; `reset` would only re-render what already failed.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <MascotScreen mood="confused" title="เกิดข้อผิดพลาด" description="โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง">
      <Button onClick={() => retry()} className="h-11 px-5">
        ลองใหม่
      </Button>
    </MascotScreen>
  );
}
